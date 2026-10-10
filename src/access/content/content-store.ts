/**
 * Where wiki pages, tasks and settings live. By default that is the
 * checkout, so they change with the checked-out branch. Teams can instead
 * keep them on a dedicated branch, checked out as a worktree inside `.git`,
 * where every edit is committed right away and sync rebases and pushes it.
 *
 * Configured with `git config gitdesk.storage worktree|branch` and
 * `gitdesk.branch` (default `gitdesk`). A clone whose remote has the
 * branch uses it automatically.
 */
import type { Head, StorageMode } from "../../contracts/model";
import { FileStore, TEXT_LIMIT } from "../files/file-store";
import { committedFile, committedFiles, fileHistory } from "../git/file-history";
import { Git, GitError } from "../git/git";
import { parseWorktrees, type FileRevision } from "../git/git-parsers";
import type { Host } from "../hosts/host";

export const DEFAULT_CONTENT_BRANCH = "gitdesk";
const NETWORK_TIMEOUT = 5 * 60_000;

export interface ContentLocation {
  readonly root: string;
  readonly files: FileStore;
  readonly git: Git;
  /** The dedicated branch, or null when content lives in the checkout. */
  readonly branch: string | null;
}

export interface ContentBranchState {
  readonly branch: string;
  readonly remote: string | null;
  readonly head: Head;
  readonly uncommitted: number;
}

export class ContentStore {
  private current: ContentLocation & { key: string };
  private failedCommit: string | null = null;

  constructor(
    private readonly host: Host,
    private readonly repository: Git,
    private readonly checkout: FileStore,
  ) {
    this.current = { key: "", root: checkout.root, files: checkout, git: repository, branch: null };
  }

  /** Why the last auto-commit failed, while edits are still uncommitted. */
  get commitFailure(): string | null {
    return this.failedCommit;
  }

  /** The current location, checking the branch out as a worktree when needed. */
  async locate(): Promise<ContentLocation> {
    const [mode, configured] = await Promise.all([this.repository.config("gitdesk.storage"), this.repository.config("gitdesk.branch")]);
    const branch = configured ?? DEFAULT_CONTENT_BRANCH;
    const refs = mode === "worktree" ? [] : await this.branchRefs(branch);
    const local = refs.includes(`refs/heads/${branch}`);
    const remote = refs.find((ref) => ref.startsWith("refs/remotes/"));
    const key = `${mode}|${branch}|${local}|${remote}`;
    if (this.current.key === key && (await this.host.kind(this.current.root, ".").catch(() => null)) === "dir") return this.current;
    if (!local && !remote) {
      this.current = { key, root: this.checkout.root, files: this.checkout, git: this.repository, branch: null };
      return this.current;
    }
    const root = await this.worktree(branch, local ? null : remote!.replace("refs/remotes/", ""));
    this.current = { key, root, files: new FileStore(this.host, root), git: new Git(this.host, root), branch };
    return this.current;
  }

  private branchRefs(branch: string): Promise<string[]> {
    return this.repository.lines(["for-each-ref", "--format=%(refname)", `refs/heads/${branch}`, `refs/remotes/*/${branch}`]);
  }

  /** The worktree of `branch`, created (tracking `upstream` when given) or repaired as needed. */
  private async worktree(branch: string, upstream: string | null): Promise<string> {
    const ref = `refs/heads/${branch}`;
    let root = (await this.worktrees()).get(ref);
    if (!root) {
      root = this.host.paths.join(await this.commonDirectory(), "gitdesk", branch);
      // After the repository folder moved, the worktree is intact but its links are stale.
      if ((await this.host.kind(root, ".").catch(() => null)) === "dir") {
        await this.repository.attempt(["worktree", "repair", root]);
        root = (await this.worktrees()).get(ref) ?? root;
      }
      await this.repository.text(["worktree", "prune"]);
    }
    if (!(await this.worktrees()).has(ref))
      await this.repository.text(
        upstream ? ["worktree", "add", "--quiet", "--track", "-b", branch, root, upstream] : ["worktree", "add", "--quiet", root, branch],
      );
    return this.host.paths.normalize(root);
  }

  private async worktrees(): Promise<Map<string, string>> {
    return parseWorktrees(await this.repository.text(["worktree", "list", "--porcelain"]));
  }

  private async commonDirectory(): Promise<string> {
    return (await this.repository.text(["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
  }

  /** Files of the content location. */
  async files(): Promise<string[]> {
    return (await this.locate()).git.files();
  }

  /**
   * Commits of the content location's branch that changed `path`, newest
   * first, following renames; with `contents`, each with the file before and after.
   */
  async history(path: string, limit: number, contents: boolean): Promise<FileRevision[]> {
    return fileHistory((await this.locate()).git, path, limit, contents);
  }

  /** `path` as last committed on the content location's branch; null when it is not. */
  async committed(path: string): Promise<string | null> {
    return committedFile((await this.locate()).git, path, TEXT_LIMIT);
  }

  /** The files below `folder` last committed on the content location's branch. */
  async committedFiles(folder: string): Promise<string[]> {
    return committedFiles((await this.locate()).git, folder);
  }

  /** The name Git signs commits with: `user.name`, or what Git derives from the system account; null if Git has none. */
  async author(): Promise<string | null> {
    // "Ada Lovelace <ada@example.com> 1791669471 +0200"
    const ident = await this.repository.attempt(["var", "GIT_AUTHOR_IDENT"]);
    return ident?.split(" <")[0]!.trim() || null;
  }

  /** State of the dedicated branch, or null when content lives in the checkout. */
  async branchState(): Promise<ContentBranchState | null> {
    const location = await this.locate();
    if (!location.branch) return null;
    const { head, changes } = await location.git.status();
    const remote = head.upstream?.split("/")[0] ?? (await this.repository.config(`branch.${location.branch}.remote`));
    return { branch: location.branch, remote, head, uncommitted: changes.length };
  }

  /**
   * Commits edited content paths right away on the dedicated branch. The
   * files are already saved; a failing commit is remembered, not thrown,
   * and the next edit or sync commits whatever is still pending.
   */
  async record(paths: readonly string[], message: string): Promise<void> {
    const { git, branch } = await this.locate();
    if (!branch) return;
    try {
      await git.text(["add", "-A", "--", ...paths]);
      if (await git.text(["diff", "--cached", "--name-only", "-z", "--", ...paths]))
        await git.text(["commit", "--quiet", "-m", message, "--", ...paths]);
      if (this.failedCommit) await this.commitPending(git);
      this.failedCommit = null;
    } catch (error) {
      this.failedCommit = (error as Error).message;
    }
  }

  private async commitPending(git: Git): Promise<void> {
    if (!(await git.text(["status", "--porcelain", "-z"]))) return;
    await git.text(["add", "-A"]);
    await git.text(["commit", "--quiet", "-m", "Commit pending GitDesk edits"]);
  }

  /**
   * Switches the storage mode. The first switch to `branch` creates the
   * branch from an empty root commit and copies `seed` (the committed wiki,
   * tasks and settings) into it.
   */
  async setMode(mode: StorageMode, seed: readonly string[]): Promise<void> {
    await this.repository.text(["config", "gitdesk.storage", mode]);
    const branch = (await this.repository.config("gitdesk.branch")) ?? DEFAULT_CONTENT_BRANCH;
    if (mode === "worktree" || (await this.branchRefs(branch)).length) return void (await this.locate());

    const common = await this.commonDirectory();
    // The empty tree must exist as an object, or `git fsck` reports it missing.
    await this.host.write(common, "gitdesk-empty", new Uint8Array(), false);
    const emptyTree = (
      await this.repository.text(["hash-object", "-w", "-t", "tree", this.host.paths.join(common, "gitdesk-empty")])
    ).trim();
    await this.host.remove(common, "gitdesk-empty");
    const start = (await this.repository.text(["commit-tree", emptyTree, "-m", "Start the GitDesk content branch"])).trim();
    await this.repository.text(["branch", branch, start]);
    const content = await this.locate();
    const head = await this.repository.attempt(["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (!head) return;
    const copied: string[] = [];
    for (const item of seed)
      if ((await this.repository.attempt(["cat-file", "-e", `HEAD:${item}`])) !== null) {
        await content.git.text(["checkout", head.trim(), "--", item]);
        copied.push(item);
      }
    if (copied.length) await content.git.text(["commit", "--quiet", "-m", "Copy wiki and tasks from the main checkout"]);
  }

  /** Rebases local content commits onto the remote branch, then pushes them. */
  async sync(): Promise<void> {
    const { git, branch } = await this.locate();
    if (!branch) throw new Error("Wiki and tasks are stored in the checkout; use Pull and Push instead.");
    const remotes = await this.repository.lines(["remote"]);
    const remote = (await this.repository.config(`branch.${branch}.remote`)) ?? (remotes.includes("origin") ? "origin" : remotes[0]);
    if (!remote) throw new Error("Add a remote in Settings to share wiki and tasks.");
    const fetched = await git.run(["fetch", remote, branch], NETWORK_TIMEOUT);
    await this.commitPending(git);
    this.failedCommit = null;
    if (fetched.code === 0) {
      try {
        await git.text(["rebase", `refs/remotes/${remote}/${branch}`]);
      } catch (error) {
        await git.attempt(["rebase", "--abort"]);
        throw new GitError(
          `Wiki or task edits conflict with ${remote}/${branch}. Resolve the rebase in a terminal at ${git.cwd}. (${(error as Error).message})`,
        );
      }
    } else if (!/couldn't find remote ref/i.test(fetched.stderr)) throw new GitError(fetched.stderr.trim());
    await git.text(["push", "--set-upstream", remote, branch], NETWORK_TIMEOUT);
  }
}
