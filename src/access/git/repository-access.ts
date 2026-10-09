/**
 * Version control of the checked-out repository: status, staging,
 * committing, history, branches, remotes. Callers validate their input;
 * this class assumes well-formed paths, names and commit IDs.
 */
import type { Change, Commit, CommitDetail, DiffSource, Head, Remote, SyncAction } from "../../contracts/model";
import { splitIntoBatches } from "../../utilities/serial-queue";
import { isMissing, type Host } from "../hosts/host";
import { Git, GitError } from "./git";
import { LOG_FORMAT, parseLog, parseNameStatus, parseRemotes } from "./git-parsers";

const NETWORK_TIMEOUT = 5 * 60_000;

export interface RepositoryState {
  readonly files: string[];
  readonly head: Head;
  readonly changes: Change[];
  readonly branches: string[];
  readonly remoteBranches: string[];
  readonly remotes: Remote[];
}

export class RepositoryAccess {
  readonly git: Git;

  constructor(
    private readonly host: Host,
    readonly root: string,
  ) {
    this.git = new Git(host, root);
  }

  /** The top folder of the repository containing `path`, in the host's path style. */
  static async locate(host: Host, path: string): Promise<string> {
    const result = await host.run("git", ["rev-parse", "--show-toplevel"], { cwd: path });
    if (result.code !== 0) {
      const message = result.stderr.trim();
      throw new Error(
        /not a git repository/i.test(message)
          ? "This folder is not inside a Git repository."
          : /dubious ownership/i.test(message)
            ? "Git refuses this folder because another user owns it. Add it to safe.directory in your Git configuration."
            : message || "Could not open the repository.",
      );
    }
    return host.paths.normalize(new TextDecoder().decode(result.stdout).trim());
  }

  async state(): Promise<RepositoryState> {
    const [files, { head, changes }, refs, remoteText] = await Promise.all([
      this.git.files(),
      this.git.status(),
      this.git.lines(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]),
      this.git.text(["remote", "-v"]),
    ]);
    const branches = refs.filter((ref) => ref.startsWith("refs/heads/")).map((ref) => ref.slice(11));
    const remoteBranches = refs
      .filter((ref) => ref.startsWith("refs/remotes/") && !ref.endsWith("/HEAD"))
      .map((ref) => ref.slice(13))
      .filter((ref) => !branches.includes(ref.slice(ref.indexOf("/") + 1)));
    return { files, head, changes, branches, remoteBranches, remotes: parseRemotes(remoteText) };
  }

  async changes(): Promise<Change[]> {
    return (await this.git.status()).changes;
  }

  async head(): Promise<Head> {
    return (await this.git.status()).head;
  }

  /** The two sides of a diff as bytes; missing sides are empty. */
  async diffSides(path: string, source: DiffSource, oldPath: string, limit: number): Promise<[Uint8Array, Uint8Array]> {
    if (source === "worktree") {
      const after = await this.host.read(this.root, path, limit).catch((error: unknown) => {
        if (isMissing(error)) return new Uint8Array();
        throw error;
      });
      return [await this.show(`:${path}`), after];
    }
    if (source === "index") return [await this.show(`HEAD:${oldPath}`), await this.show(`:${path}`)];
    return [await this.show(`${source.commit}^:${oldPath}`), await this.show(`${source.commit}:${path}`)];
  }

  private async show(spec: string): Promise<Uint8Array> {
    const result = await this.host.run("git", ["show", spec], { cwd: this.root });
    return result.code === 0 ? result.stdout : new Uint8Array();
  }

  async stage(paths: readonly string[]): Promise<void> {
    for (const batch of splitIntoBatches(paths)) await this.git.text(["add", "-A", "--", ...batch]);
  }

  /** Unstages paths, including the old side of staged renames. */
  async unstage(paths: readonly string[]): Promise<void> {
    const all = new Set(paths);
    for (const change of await this.changes()) if (all.has(change.path) && change.oldPath) all.add(change.oldPath);
    const born = await this.git.hasRef("HEAD");
    for (const batch of splitIntoBatches([...all]))
      await this.git.text(born ? ["restore", "--staged", "--", ...batch] : ["rm", "--cached", "--quiet", "-r", "--", ...batch]);
  }

  /** Reverts working-tree edits to the staged version and deletes untracked files. */
  async discard(paths: readonly string[]): Promise<void> {
    const wanted = new Set(paths);
    const changes = (await this.changes()).filter((change) => wanted.has(change.path));
    const untracked = changes.filter((change) => change.index === "?").map((change) => change.path);
    const edited = changes.filter((change) => change.index !== "?" && change.worktree !== " ").map((change) => change.path);
    for (const batch of splitIntoBatches(edited)) await this.git.text(["restore", "--worktree", "--", ...batch]);
    for (const file of untracked) await this.host.remove(this.root, file);
  }

  async commit(message: string, amend: boolean): Promise<void> {
    await this.git.text(["commit", "--quiet", ...(amend ? ["--amend"] : []), "-m", message]);
  }

  async lastCommitMessage(): Promise<string> {
    return ((await this.git.attempt(["log", "-1", "--format=%B"])) ?? "").trim();
  }

  async log(skip: number, limit: number): Promise<Commit[]> {
    const output = await this.git.attempt(["log", "--all", "--topo-order", `--skip=${skip}`, `--max-count=${limit}`, `--format=${LOG_FORMAT}`]);
    return parseLog(output ?? "");
  }

  async commitDetail(hash: string): Promise<CommitDetail> {
    const [meta, body, files] = await Promise.all([
      this.git.text(["log", "-1", `--format=${LOG_FORMAT}`, hash]),
      this.git.text(["log", "-1", "--format=%b", hash]),
      // Merges are compared with their first parent, as diffs are.
      this.git.text(["diff-tree", "--root", "-r", "--no-commit-id", "--name-status", "-z", "-M", "--diff-merges=first-parent", hash]),
    ]);
    const [commit] = parseLog(meta);
    if (!commit) throw new GitError(`Commit ${hash} does not exist.`);
    return { commit, body: body.trim(), files: parseNameStatus(files) };
  }

  async isValidBranchName(name: string): Promise<boolean> {
    return (await this.git.attempt(["check-ref-format", "--branch", name])) !== null;
  }

  /** Switches branches; a remote-only branch such as `origin/x` becomes a new tracking branch. */
  async switchBranch(name: string): Promise<void> {
    const remoteOnly = /^[^/]+\/.+$/.test(name) && !(await this.git.hasRef(`refs/heads/${name}`)) && (await this.git.hasRef(`refs/remotes/${name}`));
    await this.git.text(remoteOnly ? ["switch", "--track", name] : ["switch", name]);
  }

  async createBranch(name: string): Promise<void> {
    await this.git.text(["switch", "--create", name]);
  }

  async remoteNames(): Promise<string[]> {
    return this.git.lines(["remote"]);
  }

  async sync(action: SyncAction, remote: string, branch: string | null): Promise<void> {
    if (action === "fetch") return void (await this.git.text(["fetch", "--prune", remote], NETWORK_TIMEOUT));
    if (!branch) throw new Error("Switch to a branch first.");
    await this.git.text(action === "pull" ? ["pull", "--ff-only", remote, branch] : ["push", "--set-upstream", remote, branch], NETWORK_TIMEOUT);
  }

  async setRemote(name: string, url: string): Promise<void> {
    const exists = (await this.remoteNames()).includes(name);
    await this.git.text(["remote", exists ? "set-url" : "add", name, url]);
  }

  async removeRemote(name: string): Promise<void> {
    await this.git.text(["remote", "remove", name]);
  }
}
