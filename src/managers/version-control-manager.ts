/** Staging, committing, history, branches and remotes of the checked-out repository. */
import type { VersionControlManagerContract } from "../contracts/manager-contracts";
import type { Commit, CommitDetail, Diff, DiffSource, OperationOutcome, Stash, StashDetail, SyncAction } from "../contracts/model";
import { TEXT_LIMIT } from "../access/files/file-store";
import { isCommitId } from "../access/git/git-parsers";
import { decodeLenient, isBinary } from "../utilities/bytes";
import type { Workspace, WorkspaceRegistry } from "./workspace";

const SYNC_ACTIONS: readonly SyncAction[] = ["fetch", "pull", "push"];
const MESSAGE_LIMIT = 20_000;
const STASH_MESSAGE_LIMIT = 500;
const HISTORY_PAGE_LIMIT = 1000;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export class VersionControlManager implements VersionControlManagerContract {
  constructor(private readonly registry: WorkspaceRegistry) {}

  private on<T>(id: unknown, operation: (workspace: Workspace) => Promise<T>): Promise<T> {
    const workspace = this.registry.get(id);
    return workspace.exclusive(() => operation(workspace));
  }

  diff(id: unknown, path: unknown, source: unknown, oldPath?: unknown): Promise<Diff> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const old = oldPath === undefined || oldPath === null ? relative : workspace.path(oldPath);
      if (source !== "worktree" && source !== "index" && !isCommitId((source as { commit?: unknown } | null)?.commit))
        throw new Error("Invalid diff source.");
      const sides = await workspace.repository.diffSides(relative, source as DiffSource, old, TEXT_LIMIT);
      // Too large to show is shown like binary: no line-by-line comparison.
      if (!sides || sides.some(isBinary)) return { path: relative, binary: true, original: "", modified: "" };
      return { path: relative, binary: false, original: decodeLenient(sides[0]), modified: decodeLenient(sides[1]) };
    });
  }

  stage(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace) => workspace.repository.stage(workspace.paths(paths)));
  }

  unstage(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace) => workspace.repository.unstage(workspace.paths(paths)));
  }

  discard(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace) => workspace.repository.discard(workspace.paths(paths)));
  }

  commit(id: unknown, message: unknown, amend: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      if (typeof message !== "string" || !message.trim() || message.length > MESSAGE_LIMIT)
        throw new Error("Write a commit message first.");
      await workspace.repository.commit(message.trim(), amend === true);
    });
  }

  lastCommitMessage(id: unknown): Promise<string> {
    return this.on(id, (workspace) => workspace.repository.lastCommitMessage());
  }

  log(id: unknown, skip: unknown, limit: unknown): Promise<readonly Commit[]> {
    return this.on(id, async (workspace) => {
      if (
        !Number.isInteger(skip) ||
        !Number.isInteger(limit) ||
        (skip as number) < 0 ||
        (limit as number) < 1 ||
        (limit as number) > HISTORY_PAGE_LIMIT
      )
        throw new Error("Invalid history range.");
      return workspace.repository.log(skip as number, limit as number);
    });
  }

  commitDetail(id: unknown, hash: unknown): Promise<CommitDetail> {
    return this.on(id, async (workspace) => {
      if (!isCommitId(hash)) throw new Error("Invalid commit ID.");
      return workspace.repository.commitDetail(hash);
    });
  }

  switchBranch(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.switchBranch(await this.branchName(workspace, name)));
  }

  createBranch(id: unknown, name: unknown, start?: unknown, checkout?: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const branch = await this.branchName(workspace, name);
      const from = start === undefined || start === null ? undefined : await this.revision(workspace, start);
      await workspace.repository.createBranch(branch, from, checkout !== false);
    });
  }

  renameBranch(id: unknown, name: unknown, newName: unknown): Promise<void> {
    return this.on(id, async (workspace) =>
      workspace.repository.refs.renameBranch(await this.localBranch(workspace, name), await this.branchName(workspace, newName)),
    );
  }

  deleteBranch(id: unknown, name: unknown, force: unknown): Promise<boolean> {
    return this.on(id, async (workspace) =>
      workspace.repository.refs.deleteBranch(await this.localBranch(workspace, name), force === true),
    );
  }

  deleteRemoteBranch(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const { remote, branch } = await this.remoteBranch(workspace, name);
      await workspace.repository.refs.deleteRemoteBranch(remote, branch);
    });
  }

  setUpstream(id: unknown, branch: unknown, upstream: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const local = await this.localBranch(workspace, branch);
      await this.remoteBranch(workspace, upstream);
      await workspace.repository.refs.setUpstream(local, upstream as string);
    });
  }

  createTag(id: unknown, name: unknown, commit: unknown, message: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const tag = await this.tagName(workspace, name);
      const target = await this.revision(workspace, commit);
      if (typeof message !== "string" || message.length > MESSAGE_LIMIT) throw new Error("Invalid tag message.");
      await workspace.repository.refs.createTag(tag, target, message.trim());
    });
  }

  deleteTag(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.refs.deleteTag(await this.existingTag(workspace, name)));
  }

  pushTag(id: unknown, name: unknown, remote: unknown): Promise<void> {
    return this.on(id, async (workspace) =>
      workspace.repository.refs.pushTag(await this.existingTag(workspace, name), await this.remoteName(workspace, remote)),
    );
  }

  deleteRemoteTag(id: unknown, name: unknown, remote: unknown): Promise<void> {
    return this.on(id, async (workspace) =>
      workspace.repository.refs.deleteRemoteTag(await this.tagName(workspace, name), await this.remoteName(workspace, remote)),
    );
  }

  sync(id: unknown, action: unknown, remote: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      if (!SYNC_ACTIONS.includes(action as SyncAction)) throw new Error("Invalid action.");
      const name = await this.remoteName(workspace, remote);
      const { branch } = await workspace.repository.head();
      await workspace.repository.sync(action as SyncAction, name, branch);
    });
  }

  setRemote(id: unknown, name: unknown, url: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      if (typeof name !== "string" || !REMOTE_NAME.test(name))
        throw new Error("Remote names use letters, digits, dots, dashes and underscores.");
      if (typeof url !== "string" || !url.trim() || url.length > 2048 || url.trim().startsWith("-") || /[\r\n\0]/.test(url))
        throw new Error("Enter a valid remote URL or path.");
      await workspace.repository.setRemote(name, url.trim());
    });
  }

  removeRemote(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.removeRemote(await this.remoteName(workspace, name)));
  }

  stash(id: unknown, options: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const { message, includeUntracked, keepIndex } = (options ?? {}) as Partial<Record<string, unknown>>;
      if (typeof message !== "string" || message.length > STASH_MESSAGE_LIMIT || /[\r\n\0]/.test(message))
        throw new Error("Stash messages are one line of up to 500 characters.");
      const untracked = includeUntracked === true;
      const changes = await workspace.repository.changes();
      if (!changes.some((change) => change.index !== "?" || untracked)) throw new Error("There are no changes to stash.");
      await workspace.repository.stashes.push({ message: message.trim(), includeUntracked: untracked, keepIndex: keepIndex === true });
    });
  }

  stashDetail(id: unknown, hash: unknown): Promise<StashDetail> {
    return this.on(id, async (workspace) => workspace.repository.stashes.detail(await this.stashOf(workspace, hash)));
  }

  applyStash(id: unknown, hash: unknown, pop: unknown): Promise<OperationOutcome> {
    return this.on(id, async (workspace) => workspace.repository.stashes.apply(await this.stashOf(workspace, hash), pop === true));
  }

  dropStash(id: unknown, hash: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.stashes.drop(await this.stashOf(workspace, hash)));
  }

  branchFromStash(id: unknown, hash: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) =>
      workspace.repository.stashes.branch(await this.stashOf(workspace, hash), await this.branchName(workspace, name)),
    );
  }

  private async stashOf(workspace: Workspace, hash: unknown): Promise<Stash> {
    if (!isCommitId(hash)) throw new Error("Invalid stash.");
    return workspace.repository.stashes.find(hash);
  }

  private async branchName(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !name || name.length > 200 || name.startsWith("-")) throw new Error("Invalid branch name.");
    if (!(await workspace.repository.isValidBranchName(name))) throw new Error(`"${name}" is not a valid branch name.`);
    return name;
  }

  private async localBranch(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await workspace.repository.refs.names()).branches.includes(name)) throw new Error("Choose a branch.");
    return name;
  }

  /** A remote-tracking branch such as `origin/feature`, split into its remote and the branch there. */
  private async remoteBranch(workspace: Workspace, name: unknown): Promise<{ remote: string; branch: string }> {
    const repository = workspace.repository;
    if (typeof name !== "string" || !(await repository.refs.names()).remoteBranches.includes(name))
      throw new Error("Choose a remote branch.");
    // Remote names may hold slashes; the longest matching one wins.
    const remote = (await repository.remoteNames())
      .filter((candidate) => name.startsWith(`${candidate}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (!remote) throw new Error(`No remote is configured for ${name}.`);
    return { remote, branch: name.slice(remote.length + 1) };
  }

  private async tagName(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !name || name.length > 200 || name.startsWith("-")) throw new Error("Invalid tag name.");
    if (!(await workspace.repository.refs.isValidTagName(name))) throw new Error(`"${name}" is not a valid tag name.`);
    return name;
  }

  private async existingTag(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await workspace.repository.refs.names()).tags.includes(name)) throw new Error("Choose a tag.");
    return name;
  }

  /** A commit ID, or the name of a branch, remote branch or tag. */
  private async revision(workspace: Workspace, value: unknown): Promise<string> {
    const repository = workspace.repository;
    if (isCommitId(value) && (await repository.git.hasRef(`${value}^{commit}`))) return value;
    const { branches, remoteBranches, tags } = await repository.refs.names();
    if (typeof value === "string" && [...branches, ...remoteBranches, ...tags].includes(value)) return value;
    throw new Error("Choose a branch, tag or commit.");
  }

  private async remoteName(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await workspace.repository.remoteNames()).includes(name))
      throw new Error("Choose a configured remote.");
    return name;
  }
}
