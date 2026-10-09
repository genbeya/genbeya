/** Staging, committing, history, branches and remotes of the checked-out repository. */
import type { VersionControlManagerContract } from "../contracts/manager-contracts";
import type { Commit, CommitDetail, Diff, DiffSource, SyncAction } from "../contracts/model";
import { TEXT_LIMIT } from "../access/files/file-store";
import { isCommitId } from "../access/git/git-parsers";
import { decodeLenient, isBinary } from "../utilities/bytes";
import type { Workspace, WorkspaceRegistry } from "./workspace";

const SYNC_ACTIONS: readonly SyncAction[] = ["fetch", "pull", "push"];
const MESSAGE_LIMIT = 20_000;
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
      const [before, after] = await workspace.repository.diffSides(relative, source as DiffSource, old, TEXT_LIMIT);
      const binary = isBinary(before) || isBinary(after) || before.length > TEXT_LIMIT || after.length > TEXT_LIMIT;
      return { path: relative, binary, original: binary ? "" : decodeLenient(before), modified: binary ? "" : decodeLenient(after) };
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
      if (typeof message !== "string" || !message.trim() || message.length > MESSAGE_LIMIT) throw new Error("Write a commit message first.");
      await workspace.repository.commit(message.trim(), amend === true);
    });
  }

  lastCommitMessage(id: unknown): Promise<string> {
    return this.on(id, (workspace) => workspace.repository.lastCommitMessage());
  }

  log(id: unknown, skip: unknown, limit: unknown): Promise<readonly Commit[]> {
    return this.on(id, async (workspace) => {
      if (!Number.isInteger(skip) || !Number.isInteger(limit) || (skip as number) < 0 || (limit as number) < 1 || (limit as number) > HISTORY_PAGE_LIMIT)
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

  createBranch(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.createBranch(await this.branchName(workspace, name)));
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
      if (typeof name !== "string" || !REMOTE_NAME.test(name)) throw new Error("Remote names use letters, digits, dots, dashes and underscores.");
      if (typeof url !== "string" || !url.trim() || url.length > 2048 || url.trim().startsWith("-") || /[\r\n\0]/.test(url))
        throw new Error("Enter a valid remote URL or path.");
      await workspace.repository.setRemote(name, url.trim());
    });
  }

  removeRemote(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.removeRemote(await this.remoteName(workspace, name)));
  }

  private async branchName(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !name || name.length > 200 || name.startsWith("-")) throw new Error("Invalid branch name.");
    if (!(await workspace.repository.isValidBranchName(name))) throw new Error(`"${name}" is not a valid branch name.`);
    return name;
  }

  private async remoteName(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await workspace.repository.remoteNames()).includes(name)) throw new Error("Choose a configured remote.");
    return name;
  }
}
