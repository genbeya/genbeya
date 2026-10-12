// The text this file writes into users' repositories is licensed under MIT (LICENSE-MIT.md).
/**
 * Where wiki pages, tasks and settings live. Each area lives either in the
 * checkout, where it changes with the checked-out branch, or on the shared
 * content branch, checked out as a worktree inside `.git`, where every edit
 * is committed right away and sync rebases and pushes it.
 *
 * The content branch is `genbeya` unless `git config genbeya.branch` names
 * another. Its `.genbeya-content` file lists which areas it holds, so the
 * whole team shares the layout; a branch without that file (made by earlier
 * versions) holds every area. A clone whose remote has the branch uses it
 * automatically; `git config genbeya.storage worktree` keeps every area of
 * one clone in its checkout.
 */
import { CONTENT_AREAS, type ContentArea, type Head, type StorageMode } from "../../contracts/model";
import { encodeText } from "../../utilities/bytes";
import { SerialQueue } from "../../utilities/serial-queue";
import { FileStore, TEXT_LIMIT } from "../files/file-store";
import { committedFile, committedFiles, fileHistory } from "../git/file-history";
import { Git, GitError } from "../git/git";
import { parseWorktrees, type FileRevision } from "../git/git-parsers";
import type { Host } from "../hosts/host";

export const DEFAULT_CONTENT_BRANCH = "genbeya";
/** The file on the content branch that lists where each area lives. */
export const AREAS_FILE = ".genbeya-content";
const NETWORK_TIMEOUT = 5 * 60_000;

export type AreaModes = Readonly<Record<ContentArea, StorageMode>>;

const everyArea = (mode: StorageMode): AreaModes =>
  Object.fromEntries(CONTENT_AREAS.map((area) => [area, mode])) as Record<ContentArea, StorageMode>;
const IN_CHECKOUT = everyArea("checkout");
const ON_BRANCH = everyArea("branch");

const AREA_NAMES: Readonly<Record<ContentArea, string>> = { wiki: "the wiki", tasks: "tasks", settings: "settings" };

export interface ContentLocation {
  readonly root: string;
  readonly files: FileStore;
  readonly git: Git;
  /** The content branch, or null for the checkout. */
  readonly branch: string | null;
}

export interface ContentLayout {
  readonly areas: AreaModes;
  /** The content branch's worktree while this clone uses the branch, whether or not an area lives on it. */
  readonly branch: ContentLocation | null;
}

export interface ContentBranchState {
  readonly branch: string;
  readonly remote: string | null;
  readonly head: Head;
  readonly uncommitted: number;
}

/** The areas file, in Git's config format so Git reads it. */
const areasFile = (areas: AreaModes) =>
  [
    `# Where Genbeya keeps each area: "branch" is this content branch,`,
    `# "checkout" is the checked-out code branch of every clone.`,
    "[areas]",
    ...CONTENT_AREAS.map((area) => `\t${area} = ${areas[area]}`),
    "",
  ].join("\n");

/** `git config --list` output of an areas file; areas it does not name live in the checkout. */
function parseAreas(listed: string): AreaModes {
  const values = new Map(listed.split("\n").map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).trim()]));
  return Object.fromEntries(
    CONTENT_AREAS.map((area) => [area, values.get(`areas.${area}`) === "branch" ? "branch" : "checkout"]),
  ) as Record<ContentArea, StorageMode>;
}

export class ContentStore {
  private readonly checkout: ContentLocation;
  private worktreeLocation: (ContentLocation & { key: string }) | null = null;
  private listedAreas: { commit: string; areas: AreaModes } | null = null;
  private failedCommit: string | null = null;
  private readonly checkouts = new SerialQueue();

  constructor(
    private readonly host: Host,
    private readonly repository: Git,
    files: FileStore,
  ) {
    this.checkout = { root: files.root, files, git: repository, branch: null };
  }

  /** Why the last auto-commit failed, while edits are still uncommitted. */
  get commitFailure(): string | null {
    return this.failedCommit;
  }

  /** Where each area lives, checking the content branch out as a worktree when this clone uses it. */
  async layout(): Promise<ContentLayout> {
    const [mode, configured] = await Promise.all([this.repository.config("genbeya.storage"), this.repository.config("genbeya.branch")]);
    const name = configured ?? DEFAULT_CONTENT_BRANCH;
    const tips = mode === "worktree" ? [] : await this.branchTips(name);
    const local = tips.find((tip) => tip.ref === `refs/heads/${name}`);
    const remote = tips.find((tip) => tip.ref.startsWith("refs/remotes/"));
    const tip = local ?? remote;
    if (!tip) return { areas: IN_CHECKOUT, branch: null };
    const branch = await this.checkedOut(name, local ? null : remote!.ref.slice("refs/remotes/".length));
    return { areas: await this.areasAt(tip.commit), branch };
  }

  /** Where `area` lives: the checkout or the content branch's worktree. */
  async locate(area: ContentArea): Promise<ContentLocation> {
    const { areas, branch } = await this.layout();
    return branch && areas[area] === "branch" ? branch : this.checkout;
  }

  /** Files of the location `area` lives in. */
  async files(area: ContentArea): Promise<string[]> {
    return (await this.locate(area)).git.files();
  }

  private async branchTips(branch: string): Promise<{ ref: string; commit: string }[]> {
    const lines = await this.repository.lines([
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      `refs/heads/${branch}`,
      `refs/remotes/*/${branch}`,
    ]);
    return lines.map((line) => ({ commit: line.slice(0, line.indexOf(" ")), ref: line.slice(line.indexOf(" ") + 1) }));
  }

  /** The areas the content branch holds at `commit`; read once per commit. */
  private async areasAt(commit: string): Promise<AreaModes> {
    if (this.listedAreas?.commit !== commit) {
      const listed = await this.repository.attempt(["config", "--blob", `${commit}:${AREAS_FILE}`, "--list"]);
      this.listedAreas = { commit, areas: listed === null ? ON_BRANCH : parseAreas(listed) };
    }
    return this.listedAreas.areas;
  }

  /** One at a time: callers asking together for a missing worktree would each add it. */
  private checkedOut(branch: string, upstream: string | null): Promise<ContentLocation> {
    return this.checkouts.run(() => this.checkOut(branch, upstream));
  }

  private async checkOut(branch: string, upstream: string | null): Promise<ContentLocation> {
    const key = `${branch}|${upstream}`;
    const current = this.worktreeLocation;
    if (current?.key === key && (await this.host.kind(current.root, ".").catch(() => null)) === "dir") return current;
    const root = await this.worktree(branch, upstream);
    this.worktreeLocation = { key, root, files: new FileStore(this.host, root), git: new Git(this.host, root), branch };
    return this.worktreeLocation;
  }

  /** The worktree of `branch`, created (tracking `upstream` when given) or repaired as needed. */
  private async worktree(branch: string, upstream: string | null): Promise<string> {
    const ref = `refs/heads/${branch}`;
    let root = (await this.worktrees()).get(ref);
    if (!root) {
      root = this.host.paths.join(await this.commonDirectory(), "genbeya", branch);
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

  /**
   * Commits that changed `path` on the branch `area` lives on, newest first,
   * following renames; with `contents`, each with the file before and after.
   */
  async history(area: ContentArea, path: string, limit: number, contents: boolean): Promise<FileRevision[]> {
    return fileHistory((await this.locate(area)).git, path, limit, contents);
  }

  /** `path` as last committed on the branch `area` lives on; null when it is not. */
  async committed(area: ContentArea, path: string): Promise<string | null> {
    return committedFile((await this.locate(area)).git, path, TEXT_LIMIT);
  }

  /** The files below `folder` last committed on the branch `area` lives on. */
  async committedFiles(area: ContentArea, folder: string): Promise<string[]> {
    return committedFiles((await this.locate(area)).git, folder);
  }

  /** The name Git signs commits with: `user.name`, or what Git derives from the system account; null if Git has none. */
  async author(): Promise<string | null> {
    // "Ada Lovelace <ada@example.com> 1791669471 +0200"
    const ident = await this.repository.attempt(["var", "GIT_AUTHOR_IDENT"]);
    return ident?.split(" <")[0]!.trim() || null;
  }

  /** State of the content branch, or null while this clone does not use one. */
  async branchState(): Promise<ContentBranchState | null> {
    const { branch: location } = await this.layout();
    if (!location) return null;
    const { head, changes } = await location.git.status();
    const remote = head.upstream?.split("/")[0] ?? (await this.repository.config(`branch.${location.branch}.remote`));
    return { branch: location.branch!, remote, head, uncommitted: changes.length };
  }

  /**
   * Commits edited paths of `area` right away when it lives on the content
   * branch. The files are already saved; a failing commit is remembered, not
   * thrown, and the next edit or sync commits whatever is still pending.
   */
  async record(area: ContentArea, paths: readonly string[], message: string): Promise<void> {
    const { git, branch } = await this.locate(area);
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
    await git.text(["commit", "--quiet", "-m", "Commit pending Genbeya edits"]);
  }

  /**
   * Moves `area`, whose files are at `path`, into the checkout or onto the
   * content branch, and records the new layout on the branch for everyone.
   * The side the area moves to gets the other side's files: the branch the
   * checked-out commit's files, the checkout the branch's files as
   * uncommitted changes. Nothing is lost: the branch keeps its copy in its
   * history, and uncommitted changes in the checkout stop the move.
   */
  async setStorage(area: ContentArea, mode: StorageMode, path: string): Promise<void> {
    if ((await this.layout()).areas[area] === mode) return;
    if (await this.repository.text(["status", "--porcelain", "-z", "--", path]))
      throw new Error(
        `Commit or discard the changes in ${path} first: ${
          mode === "branch" ? "the content branch gets the committed files." : "the files from the content branch replace them."
        }`,
      );
    // A choice made here ends this clone's opt-out; the team's layout on the branch applies again.
    await this.repository.attempt(["config", "--unset", "genbeya.storage"]);
    const created = mode === "branch" && (await this.startBranch());
    const { areas, branch } = await this.layout();
    // A new branch starts with nothing on it; one without an areas file would hold every area.
    const before = created ? IN_CHECKOUT : areas;
    if (!branch || before[area] === mode) return;
    await this.commitPending(branch.git);
    await this.copyAcross(branch.git, mode, path);
    await this.host.write(branch.root, AREAS_FILE, encodeText(areasFile({ ...before, [area]: mode })), false);
    await branch.git.text(["add", "--", AREAS_FILE]);
    await branch.git.text([
      "commit",
      "--quiet",
      "-m",
      `Move ${AREA_NAMES[area]} to the ${mode === "branch" ? "content branch" : "checkout"}`,
    ]);
  }

  /**
   * Gives the side `mode` names the files at `path` from the other side's
   * last commit, removing what that commit does not have. The branch gets
   * them staged, to commit with the move; the checkout as uncommitted changes.
   */
  private async copyAcross(content: Git, mode: StorageMode, path: string): Promise<void> {
    const [from, to, index] = mode === "branch" ? [this.repository, content, ["--staged"]] : [content, this.repository, []];
    const source = await from.objectId("HEAD");
    if (source && (await this.holds(source, path))) await to.text(["restore", `--source=${source}`, ...index, "--worktree", "--", path]);
    // Where that commit has no such files, the files here go as well.
    else if (await to.text(["ls-files", "-z", "--", path])) {
      await to.text(["rm", "-r", "-q", "--", path]);
      if (!index.length) await to.text(["reset", "-q", "--", path]);
    }
  }

  private async holds(commit: string, path: string): Promise<boolean> {
    return (await this.repository.attempt(["cat-file", "-e", `${commit}:${path}`])) !== null;
  }

  /** Creates the content branch from an empty root commit unless it exists here or on a remote; true when it did. */
  private async startBranch(): Promise<boolean> {
    const name = (await this.repository.config("genbeya.branch")) ?? DEFAULT_CONTENT_BRANCH;
    if ((await this.branchTips(name)).length) return false;
    const common = await this.commonDirectory();
    // The empty tree must exist as an object, or `git fsck` reports it missing.
    await this.host.write(common, "genbeya-empty", new Uint8Array(), false);
    const emptyTree = (
      await this.repository.text(["hash-object", "-w", "-t", "tree", this.host.paths.join(common, "genbeya-empty")])
    ).trim();
    await this.host.remove(common, "genbeya-empty");
    const start = (await this.repository.text(["commit-tree", emptyTree, "-m", "Start the Genbeya content branch"])).trim();
    await this.repository.text(["branch", name, start]);
    return true;
  }

  /** Rebases local content commits onto the remote branch, then pushes them. */
  async sync(): Promise<void> {
    const { branch: location } = await this.layout();
    if (!location) throw new Error("Wiki, tasks and settings are stored in the checkout; use Pull and Push instead.");
    const { git } = location;
    const branch = location.branch!;
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
