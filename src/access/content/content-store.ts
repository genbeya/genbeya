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
 *
 * Repositories set up before Genbeya was renamed from GitDesk keep working:
 * a `gitdesk` branch serves as the content branch while there is no
 * `genbeya` one, a branch with only `.gitdesk-content` keeps that file, the
 * `gitdesk.*` config keys apply while the `genbeya.*` ones are not set, and
 * the worktree moves from `.git/gitdesk/` to `.git/genbeya/`.
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
/** The content branch GitDesk made, used while there is no {@link DEFAULT_CONTENT_BRANCH}. */
export const LEGACY_CONTENT_BRANCH = "gitdesk";
/** The file on the content branch that lists where each area lives. */
export const AREAS_FILE = ".genbeya-content";
/** The areas file of content branches GitDesk made, read and kept while the branch has no {@link AREAS_FILE}. */
export const LEGACY_AREAS_FILE = ".gitdesk-content";
/** The folder in the git directory that holds the content branch's worktree, and where GitDesk kept it. */
const WORKTREE_FOLDER = "genbeya";
const LEGACY_WORKTREE_FOLDER = "gitdesk";
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
  /** The branch's areas file, {@link AREAS_FILE} or GitDesk's {@link LEGACY_AREAS_FILE}; null without one. */
  readonly areasFile: string | null;
}

export interface ContentBranchState {
  readonly branch: string;
  readonly remote: string | null;
  readonly head: Head;
  readonly uncommitted: number;
}

/** The areas file, in Git's config format so Git reads it. */
const areasText = (areas: AreaModes) =>
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

/** `git config` of `key` in the `genbeya` section, or in GitDesk's `gitdesk` section while that is not set. */
async function configured(git: Git, key: string): Promise<string | null> {
  return (await git.config(`genbeya.${key}`)) ?? (await git.config(`gitdesk.${key}`));
}

interface Tip {
  readonly ref: string;
  readonly commit: string;
}

export class ContentStore {
  private readonly checkout: ContentLocation;
  private worktreeLocation: (ContentLocation & { key: string }) | null = null;
  private listedAreas: { commit: string; areas: AreaModes; file: string | null } | null = null;
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
    if ((await configured(this.repository, "storage")) === "worktree") return { areas: IN_CHECKOUT, branch: null, areasFile: null };
    const { name, tips } = await this.contentBranch();
    const local = tips.find((tip) => tip.ref === `refs/heads/${name}`);
    const remote = tips.find((tip) => tip.ref.startsWith("refs/remotes/"));
    const tip = local ?? remote;
    if (!tip) return { areas: IN_CHECKOUT, branch: null, areasFile: null };
    const branch = await this.checkedOut(name, local ? null : remote!.ref.slice("refs/remotes/".length));
    const { areas, file } = await this.areasAt(tip.commit);
    return { areas, branch, areasFile: file };
  }

  /**
   * The content branch's name and its tips here and on remotes: the
   * configured branch, else `genbeya`, else the `gitdesk` branch GitDesk
   * made, while only that exists here or on a remote.
   */
  private async contentBranch(): Promise<{ name: string; tips: Tip[] }> {
    const name = await configured(this.repository, "branch");
    if (name) return { name, tips: await this.branchTips([name]) };
    const tips = await this.branchTips([DEFAULT_CONTENT_BRANCH, LEGACY_CONTENT_BRANCH]);
    // Remote names may contain slashes; branch names here have none.
    const of = (branch: string) => tips.filter((tip) => tip.ref.endsWith(`/${branch}`));
    const current = of(DEFAULT_CONTENT_BRANCH);
    const legacy = of(LEGACY_CONTENT_BRANCH);
    return !current.length && legacy.length
      ? { name: LEGACY_CONTENT_BRANCH, tips: legacy }
      : { name: DEFAULT_CONTENT_BRANCH, tips: current };
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

  private async branchTips(branches: readonly string[]): Promise<Tip[]> {
    const lines = await this.repository.lines([
      "for-each-ref",
      "--format=%(objectname) %(refname)",
      ...branches.flatMap((branch) => [`refs/heads/${branch}`, `refs/remotes/*/${branch}`]),
    ]);
    return lines.map((line) => ({ commit: line.slice(0, line.indexOf(" ")), ref: line.slice(line.indexOf(" ") + 1) }));
  }

  /**
   * The areas the content branch holds at `commit`, and the file listing
   * them: {@link AREAS_FILE}, or GitDesk's {@link LEGACY_AREAS_FILE} while
   * the branch has only that; null without either. Read once per commit.
   */
  private async areasAt(commit: string): Promise<{ areas: AreaModes; file: string | null }> {
    if (this.listedAreas?.commit !== commit) {
      const list = (file: string) => this.repository.attempt(["config", "--blob", `${commit}:${file}`, "--list"]);
      const listed = await list(AREAS_FILE);
      const legacy = listed === null ? await list(LEGACY_AREAS_FILE) : null;
      const found = listed ?? legacy;
      this.listedAreas = {
        commit,
        areas: found === null ? ON_BRANCH : parseAreas(found),
        file: listed !== null ? AREAS_FILE : legacy !== null ? LEGACY_AREAS_FILE : null,
      };
    }
    return this.listedAreas;
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

  /**
   * The worktree of `branch`, created (tracking `upstream` when given) or
   * repaired as needed, and moved out of the folder GitDesk kept it in.
   */
  private async worktree(branch: string, upstream: string | null): Promise<string> {
    const ref = `refs/heads/${branch}`;
    const common = await this.commonDirectory();
    const target = this.host.paths.join(common, WORKTREE_FOLDER, branch);
    const legacy = this.host.paths.join(common, LEGACY_WORKTREE_FOLDER, branch);
    let root = (await this.worktrees()).get(ref);
    if (!root) {
      // After the repository folder moved, the worktree is intact but its links are stale.
      for (const candidate of [target, legacy])
        if (!root && (await this.host.kind(candidate, ".").catch(() => null)) === "dir") {
          await this.repository.attempt(["worktree", "repair", candidate]);
          root = (await this.worktrees()).get(ref);
        }
      await this.repository.text(["worktree", "prune"]);
    }
    if (!root) {
      root = target;
      await this.repository.text(
        upstream ? ["worktree", "add", "--quiet", "--track", "-b", branch, root, upstream] : ["worktree", "add", "--quiet", root, branch],
      );
    } else if (this.host.paths.normalize(root) === this.host.paths.normalize(legacy))
      root = await this.moveWorktree(legacy, target, common);
    return this.host.paths.normalize(root);
  }

  /**
   * Moves the worktree from GitDesk's folder in the git directory to
   * `target`, with whatever is uncommitted in it. Where git cannot move it
   * (a program holds a file in it open, say), it stays and keeps working.
   */
  private async moveWorktree(legacy: string, target: string, common: string): Promise<string> {
    if ((await this.host.kind(target, ".").catch(() => null)) !== null) return legacy;
    // Git creates no missing folders for the move; writing a file in it does.
    const marker = `${WORKTREE_FOLDER}/.moving`;
    await this.host.write(common, marker, new Uint8Array(), false);
    await this.host.remove(common, marker);
    if ((await this.repository.attempt(["worktree", "move", legacy, target])) === null) {
      await this.host.removeEmptyFolder(common, WORKTREE_FOLDER).catch(() => false);
      return legacy;
    }
    await this.host.removeEmptyFolder(common, LEGACY_WORKTREE_FOLDER).catch(() => false);
    return target;
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
    for (const section of ["genbeya", "gitdesk"]) await this.repository.attempt(["config", "--unset", `${section}.storage`]);
    const created = mode === "branch" && (await this.startBranch());
    const { areas, branch, areasFile } = await this.layout();
    // A new branch starts with nothing on it; one without an areas file would hold every area.
    const before = created ? IN_CHECKOUT : areas;
    if (!branch || before[area] === mode) return;
    await this.commitPending(branch.git);
    await this.copyAcross(branch.git, mode, path);
    // GitDesk's file keeps its name, as does a new one on GitDesk's branch: teammates still on GitDesk read it.
    const file = areasFile ?? (branch.branch === LEGACY_CONTENT_BRANCH ? LEGACY_AREAS_FILE : AREAS_FILE);
    await this.host.write(branch.root, file, encodeText(areasText({ ...before, [area]: mode })), false);
    await branch.git.text(["add", "--", file]);
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
    const { name, tips } = await this.contentBranch();
    if (tips.length) return false;
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

  /**
   * Gives the files GitDesk named Genbeya's names: the settings file
   * (`settings`, from and to, when given) where the settings live, and
   * GitDesk's areas file on the content branch. A rename in the checkout is
   * staged, to commit like code; those on the content branch are committed
   * together. Resolves to the files renamed.
   */
  async renameLegacyFiles(settings: readonly [string, string] | null): Promise<string[]> {
    const { areas, branch, areasFile } = await this.layout();
    const renames: [ContentLocation, string, string][] = [];
    if (settings) renames.push([branch && areas.settings === "branch" ? branch : this.checkout, ...settings]);
    if (branch && areasFile === LEGACY_AREAS_FILE) renames.push([branch, LEGACY_AREAS_FILE, AREAS_FILE]);
    const committed: string[] = [];
    for (const [{ git, files, branch: onBranch }, from, to] of renames) {
      // A file git does not track yet just moves.
      const tracked = (await git.attempt(["ls-files", "--error-unmatch", "--", from])) !== null;
      if (tracked) await git.text(["mv", "--", from, to]);
      else await files.moveAll([[from, to]]);
      if (onBranch) {
        await git.text(["add", "--", to]);
        committed.push(...(tracked ? [from, to] : [to]));
      }
    }
    if (branch && committed.length) {
      const names = renames.filter(([location]) => location === branch).map(([, from, to]) => `${from} to ${to}`);
      await branch.git.text(["commit", "--quiet", "-m", `Rename ${names.join(" and ")}`, "--", ...committed]);
    }
    return renames.map(([, from]) => from);
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
