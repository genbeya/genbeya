/** Staging, committing, history, branches and remotes of the checked-out repository. */
import type { VersionControlManagerContract } from "../contracts/manager-contracts";
import type {
  Commit,
  CommitDetail,
  ConflictFile,
  ConflictResolution,
  Diff,
  DiffSource,
  ForcePushPlan,
  OperationOutcome,
  PushOutcome,
  PushPlan,
  PushRequest,
  RebasePlan,
  RebaseStep,
  ResetMode,
  ResetPlan,
  ResetResult,
  Stash,
  StashDetail,
  SyncAction,
} from "../contracts/model";
import { isDefaultBranch, REBASE_ACTIONS, RESET_MODES } from "../contracts/model";
import { TEXT_LIMIT } from "../access/files/file-store";
import { isCommitId } from "../access/git/git-parsers";
import { REBASE_LIMIT } from "../access/git/operation-access";
import type { RebaseEngine } from "../engines/rebase-engine";
import { decodeLenient, isBinary } from "../utilities/bytes";
import type { Workspace, WorkspaceRegistry } from "./workspace";

const SYNC_ACTIONS: readonly SyncAction[] = ["fetch", "pull", "push"];
const MESSAGE_LIMIT = 20_000;
const STASH_MESSAGE_LIMIT = 500;
const HISTORY_PAGE_LIMIT = 1000;
const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/**
 * `name`, unless it or one of its parts starts with "-": Git could read it
 * as an option, and switching to a remote branch `origin/-x` names the new
 * local branch `-x`. Git allows such refs, and a clone may bring them.
 */
function plainRef(name: string): string {
  if (/(^|\/)-/.test(name)) throw new Error(`"${name}" looks like an option to Git. Rename or delete it in a terminal.`);
  return name;
}

export class VersionControlManager implements VersionControlManagerContract {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly rebases: RebaseEngine,
  ) {}

  private on<T>(id: unknown, operation: (workspace: Workspace) => Promise<T>): Promise<T> {
    const workspace = this.registry.get(id);
    return workspace.exclusive(() => operation(workspace));
  }

  /**
   * Like {@link on}, for merges, rebases, picks, reverts and stash applies:
   * while another is unfinished git refuses to start one, which would read
   * as having stopped for conflicts.
   */
  private starting<T>(id: unknown, operation: (workspace: Workspace) => Promise<T>): Promise<T> {
    return this.on(id, async (workspace) => {
      const { operations } = workspace.repository;
      const current = await operations.current(null);
      if (current) throw new Error(`Finish or abort the ${current.kind} first.`);
      if (await operations.conflicted()) throw new Error("Resolve the conflicted files first.");
      return operation(workspace);
    });
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

  pushPlan(id: unknown, branch: unknown): Promise<PushPlan> {
    return this.on(id, async (workspace) => workspace.repository.pushes.plan(await this.localBranch(workspace, branch)));
  }

  forcePushPlan(id: unknown, branch: unknown, remote: unknown, remoteBranch: unknown): Promise<ForcePushPlan> {
    return this.on(id, async (workspace) =>
      workspace.repository.pushes.forcePlan(
        await this.localBranch(workspace, branch),
        await this.remoteName(workspace, remote),
        await this.pushedBranchName(workspace, remoteBranch),
      ),
    );
  }

  push(id: unknown, request: unknown): Promise<PushOutcome> {
    return this.on(id, async (workspace) => {
      const { branch, remote, remoteBranch, setUpstream, force } = (request ?? {}) as Partial<Record<string, unknown>>;
      if (typeof setUpstream !== "boolean") throw new Error("Invalid push.");
      const lease = this.forceOf(force);
      const checked: PushRequest = {
        branch: await this.localBranch(workspace, branch),
        remote: await this.remoteName(workspace, remote),
        remoteBranch: await this.pushedBranchName(workspace, remoteBranch),
        setUpstream,
        ...(lease ? { force: lease } : {}),
      };
      if (lease && !lease.defaultBranch) await this.notDefaultBranch(workspace, checked.remote, checked.remoteBranch);
      return workspace.repository.pushes.push(checked);
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
    return this.starting(id, async (workspace) => workspace.repository.stashes.apply(await this.stashOf(workspace, hash), pop === true));
  }

  dropStash(id: unknown, hash: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.stashes.drop(await this.stashOf(workspace, hash)));
  }

  branchFromStash(id: unknown, hash: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) =>
      workspace.repository.stashes.branch(await this.stashOf(workspace, hash), await this.branchName(workspace, name)),
    );
  }

  merge(id: unknown, ref: unknown, options: unknown): Promise<OperationOutcome> {
    return this.starting(id, async (workspace) => {
      const source = await this.revision(workspace, ref);
      const { noFastForward, message } = (options ?? {}) as Partial<Record<string, unknown>>;
      if (typeof message !== "string" || message.length > MESSAGE_LIMIT) throw new Error("Invalid merge message.");
      return workspace.repository.operations.merge(source, { noFastForward: noFastForward === true, message: message.trim() });
    });
  }

  rebase(id: unknown, onto: unknown, autostash: unknown): Promise<OperationOutcome> {
    return this.starting(id, async (workspace) => {
      const target = await this.revision(workspace, onto);
      await this.cleanUnless(workspace, autostash);
      return workspace.repository.operations.rebase(target, autostash === true);
    });
  }

  pullRebase(id: unknown, remote: unknown, autostash: unknown): Promise<OperationOutcome> {
    return this.starting(id, async (workspace) => {
      const name = await this.remoteName(workspace, remote);
      await this.cleanUnless(workspace, autostash);
      const { branch } = await workspace.repository.head();
      return workspace.repository.pullRebase(name, branch, autostash === true);
    });
  }

  rebasePlan(id: unknown, base: unknown): Promise<RebasePlan> {
    return this.on(id, async (workspace) => workspace.repository.operations.plan(await this.revision(workspace, base)));
  }

  rebaseInteractive(id: unknown, base: unknown, steps: unknown, autostash: unknown): Promise<OperationOutcome> {
    return this.starting(id, async (workspace) => {
      const operations = workspace.repository.operations;
      if (!isCommitId(base) || !(await operations.isAncestorOfHead(base))) throw new Error("Choose a commit of the current branch.");
      const chosen = this.rebaseSteps(steps);
      await this.cleanUnless(workspace, autostash);
      const todo = this.rebases.todo((await operations.plan(base)).commits, chosen);
      return operations.rebaseInteractive(base, todo, autostash === true);
    });
  }

  cherryPick(id: unknown, hash: unknown): Promise<OperationOutcome> {
    return this.starting(id, async (workspace) => {
      const commit = await this.singleParent(workspace, hash);
      // Git would start a pick with nothing to commit, which only skipping ends.
      if (await workspace.repository.operations.isAncestorOfHead(commit))
        throw new Error(`${commit.slice(0, 7)} is already on ${(await workspace.repository.head()).branch ?? "the checked-out commit"}.`);
      return workspace.repository.operations.cherryPick(commit);
    });
  }

  revert(id: unknown, hash: unknown): Promise<OperationOutcome> {
    return this.starting(id, async (workspace) => workspace.repository.operations.revert(await this.singleParent(workspace, hash)));
  }

  // Resets refuse while an operation is in progress: aborting it afterwards would go back to before the reset.

  resetPlan(id: unknown, hash: unknown): Promise<ResetPlan> {
    return this.starting(id, async (workspace) => workspace.repository.resets.plan(await this.existingCommit(workspace, hash)));
  }

  reset(id: unknown, hash: unknown, mode: unknown, expectedHead: unknown): Promise<ResetResult> {
    return this.starting(id, async (workspace) => {
      if (!RESET_MODES.includes(mode as ResetMode)) throw new Error("Invalid reset mode.");
      const target = await this.existingCommit(workspace, hash);
      if (!isCommitId(expectedHead)) throw new Error("Invalid commit ID.");
      const branch = await this.currentBranch(workspace);
      if ((await workspace.repository.git.objectId("HEAD")) !== expectedHead)
        throw new Error(`${branch} moved since you chose the reset. Look at it again first.`);
      return workspace.repository.resets.reset(target, mode as ResetMode);
    });
  }

  undoLastCommit(id: unknown): Promise<ResetResult> {
    return this.starting(id, async (workspace) => {
      await this.currentBranch(workspace);
      const resets = workspace.repository.resets;
      return resets.reset(await resets.parentOfHead(), "soft");
    });
  }

  continueOperation(id: unknown): Promise<OperationOutcome> {
    return this.on(id, (workspace) => workspace.repository.operations.continue());
  }

  skipOperation(id: unknown): Promise<OperationOutcome> {
    return this.on(id, (workspace) => workspace.repository.operations.skip());
  }

  abortOperation(id: unknown): Promise<void> {
    return this.on(id, (workspace) => workspace.repository.operations.abort());
  }

  conflict(id: unknown, path: unknown): Promise<ConflictFile> {
    return this.on(id, async (workspace) => workspace.repository.operations.conflict(workspace.path(path)));
  }

  resolveConflict(id: unknown, path: unknown, resolution: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const { use, text } = (resolution ?? {}) as Partial<Record<string, unknown>>;
      let resolved: ConflictResolution;
      if (use === "text" && typeof text === "string" && text.length <= TEXT_LIMIT) resolved = { use, text };
      else if (use === "ours" || use === "theirs" || use === "worktree" || use === "delete") resolved = { use };
      else throw new Error("Invalid resolution.");
      if (!(await workspace.repository.operations.conflictedPaths()).includes(relative)) throw new Error(`${relative} has no conflicts.`);
      await workspace.repository.operations.resolve(relative, resolved);
    });
  }

  private rebaseSteps(steps: unknown): RebaseStep[] {
    if (!Array.isArray(steps) || !steps.length || steps.length > REBASE_LIMIT) throw new Error("Invalid rebase steps.");
    return steps.map((value) => {
      const { hash, action, message } = (value ?? {}) as Partial<Record<string, unknown>>;
      if (!isCommitId(hash) || !REBASE_ACTIONS.includes(action as RebaseStep["action"])) throw new Error("Invalid rebase steps.");
      if (message !== undefined && (typeof message !== "string" || message.length > MESSAGE_LIMIT))
        throw new Error("Invalid commit message.");
      return { hash, action: action as RebaseStep["action"], ...(message === undefined ? {} : { message }) };
    });
  }

  /** Rewriting history needs a clean working tree, unless the changes are stashed meanwhile. */
  private async cleanUnless(workspace: Workspace, autostash: unknown): Promise<void> {
    if (autostash === true) return;
    if ((await workspace.repository.changes()).some((change) => change.index !== "?"))
      throw new Error("Commit or stash your changes first.");
  }

  /** A commit with one parent: picking or reverting a merge needs to know which side to follow. */
  private async singleParent(workspace: Workspace, hash: unknown): Promise<string> {
    if (!isCommitId(hash)) throw new Error("Invalid commit ID.");
    const { commit } = await workspace.repository.commitDetail(hash);
    if (commit.parents.length > 1) throw new Error("GitDesk does not cherry-pick or revert merge commits. Use the terminal instead.");
    return hash;
  }

  private async stashOf(workspace: Workspace, hash: unknown): Promise<Stash> {
    if (!isCommitId(hash)) throw new Error("Invalid stash.");
    return workspace.repository.stashes.find(hash);
  }

  private async branchName(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !name || name.length > 200 || name.startsWith("-")) throw new Error("Invalid branch name.");
    if (!(await workspace.repository.isValidBranchName(name))) throw new Error(`"${name}" is not a valid branch name.`);
    return plainRef(name);
  }

  /** A push request's `force`: none, or the commit the lease expects (null: no branch) and whether the default branch may go. */
  private forceOf(force: unknown): PushRequest["force"] {
    if (force === undefined || force === null) return undefined;
    const { expected, defaultBranch } = (typeof force === "object" ? force : {}) as Partial<Record<string, unknown>>;
    if ((expected !== null && !isCommitId(expected)) || typeof defaultBranch !== "boolean") throw new Error("Invalid push.");
    return { expected, defaultBranch };
  }

  /** Refuses to force push to the branch everyone starts from, unless the user said they mean it. */
  private async notDefaultBranch(workspace: Workspace, remote: string, branch: string): Promise<void> {
    const known = await workspace.repository.pushes.defaultBranch(remote);
    if (!isDefaultBranch(branch, known)) return;
    throw new Error(
      (known
        ? `${branch} is the default branch of ${remote}. `
        : `GitDesk can't tell the default branch of ${remote}, and ${branch} may be it. `) +
        "Force pushing to it rewrites the history everyone starts from; confirm that you mean it.",
    );
  }

  /** A branch to create on a remote by pushing: a valid branch name, but not one git would read as HEAD or a reflog entry. */
  private async pushedBranchName(workspace: Workspace, name: unknown): Promise<string> {
    if (name === "HEAD" || (typeof name === "string" && name.includes("@{"))) throw new Error("Invalid branch name.");
    return this.branchName(workspace, name);
  }

  private async currentBranch(workspace: Workspace): Promise<string> {
    const { branch } = await workspace.repository.head();
    if (!branch) throw new Error("Switch to a branch first.");
    return branch;
  }

  private async existingCommit(workspace: Workspace, hash: unknown): Promise<string> {
    if (!isCommitId(hash) || !(await workspace.repository.git.hasRef(`${hash}^{commit}`))) throw new Error("Choose a commit.");
    return hash;
  }

  private async localBranch(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await workspace.repository.refs.names()).branches.includes(name)) throw new Error("Choose a branch.");
    return plainRef(name);
  }

  /** A remote-tracking branch such as `origin/feature`, split into its remote and the branch there. */
  private async remoteBranch(workspace: Workspace, name: unknown): Promise<{ remote: string; branch: string }> {
    const repository = workspace.repository;
    if (typeof name !== "string" || !(await repository.refs.names()).remoteBranches.includes(name))
      throw new Error("Choose a remote branch.");
    plainRef(name);
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
    return plainRef(name);
  }

  private async existingTag(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await workspace.repository.refs.names()).tags.includes(name)) throw new Error("Choose a tag.");
    return plainRef(name);
  }

  /** A commit ID, or the name of a branch, remote branch or tag. */
  private async revision(workspace: Workspace, value: unknown): Promise<string> {
    const repository = workspace.repository;
    if (isCommitId(value) && (await repository.git.hasRef(`${value}^{commit}`))) return value;
    const { branches, remoteBranches, tags } = await repository.refs.names();
    if (typeof value === "string" && [...branches, ...remoteBranches, ...tags].includes(value)) return plainRef(value);
    throw new Error("Choose a branch, tag or commit.");
  }

  private async remoteName(workspace: Workspace, name: unknown): Promise<string> {
    if (typeof name !== "string" || !(await workspace.repository.remoteNames()).includes(name))
      throw new Error("Choose a configured remote.");
    return name;
  }
}
