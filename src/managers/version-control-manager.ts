/** Staging, committing, history, branches and remotes of the checked-out repository. */
import type { VersionControlManagerContract } from "../contracts/manager-contracts";
import type {
  ChangeBase,
  Commit,
  CommitDetail,
  ConflictFile,
  ConflictResolution,
  Diff,
  DiffSource,
  IgnoreKind,
  LinePatch,
  LineRange,
  OperationOutcome,
  RebasePlan,
  RebaseStep,
  Stash,
  StashDetail,
  SyncAction,
} from "../contracts/model";
import { CHANGE_BASES, IGNORE_KINDS, REBASE_ACTIONS } from "../contracts/model";
import { TEXT_LIMIT } from "../access/files/file-store";
import { isCommitId } from "../access/git/git-parsers";
import { REBASE_LIMIT } from "../access/git/operation-access";
import type { PatchTarget } from "../access/git/staging-access";
import { isMissing } from "../access/hosts/host";
import type { PatchEngine } from "../engines/patch-engine";
import type { RebaseEngine } from "../engines/rebase-engine";
import { decodeLenient, isBinary, sha256, sha256Bytes } from "../utilities/bytes";
import { appendIgnoreRule, extensionOf, ignoreFile, ignoreRule } from "../utilities/gitignore";
import type { Workspace, WorkspaceRegistry } from "./workspace";

const SYNC_ACTIONS: readonly SyncAction[] = ["fetch", "pull", "push"];
const LINE_RANGE_LIMIT = 10_000;
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

/** What staged changes are compared with; HEAD unless given. */
function changeBase(value: unknown): ChangeBase {
  if (value === undefined || value === null) return "head";
  if (!CHANGE_BASES.includes(value as ChangeBase)) throw new Error("Invalid comparison base.");
  return value as ChangeBase;
}

/** The version of a diff's two sides; empty when they are too large to compare. */
const versionOf = (sides: readonly [Uint8Array, Uint8Array] | null): string => (sides ? sha256(sides.map(sha256Bytes).join(":")) : "");

function lineRanges(value: unknown): LineRange[] {
  if (!Array.isArray(value) || value.length > LINE_RANGE_LIMIT) throw new Error("Invalid line selection.");
  return value.map((range) => {
    const { from, to } = (range ?? {}) as Partial<Record<string, unknown>>;
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || (from as number) < 1 || (to as number) < (from as number))
      throw new Error("Invalid line selection.");
    return { from: from as number, to: to as number };
  });
}

export class VersionControlManager implements VersionControlManagerContract {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly rebases: RebaseEngine,
    private readonly patches: PatchEngine,
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

  diff(id: unknown, path: unknown, source: unknown, oldPath?: unknown, base?: unknown): Promise<Diff> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const old = oldPath === undefined || oldPath === null ? relative : workspace.path(oldPath);
      if (source !== "worktree" && source !== "index" && !isCommitId((source as { commit?: unknown } | null)?.commit))
        throw new Error("Invalid diff source.");
      const sides = await workspace.repository.diffSides(relative, source as DiffSource, old, TEXT_LIMIT, changeBase(base));
      // Too large to show is shown like binary: no line-by-line comparison.
      if (!sides || sides.some(isBinary)) return { path: relative, binary: true, original: "", modified: "", version: versionOf(sides) };
      return {
        path: relative,
        binary: false,
        original: decodeLenient(sides[0]),
        modified: decodeLenient(sides[1]),
        version: versionOf(sides),
      };
    });
  }

  stage(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace) => workspace.repository.stage(workspace.paths(paths)));
  }

  unstage(id: unknown, paths: unknown, base?: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const valid = workspace.paths(paths);
      if (changeBase(base) === "head") return workspace.repository.unstage(valid);
      // Renames are compared with the parent too: their old side comes back as well.
      const { staging } = workspace.repository;
      const tree = await staging.base("parent");
      const all = new Set(valid);
      for (const file of await staging.staged(tree)) if (all.has(file.path) && file.oldPath) all.add(file.oldPath);
      await staging.reset(tree, [...all]);
    });
  }

  discard(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace) => workspace.repository.discard(workspace.paths(paths)));
  }

  stageLines(id: unknown, patch: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const request = this.linePatch(workspace, patch);
      const { staging } = workspace.repository;
      const untracked = await this.isUntracked(workspace, request.path);
      await this.current(workspace, request, "worktree", "head");
      // An untracked file has no diff until the index knows it is coming.
      if (untracked) await staging.intendToAdd(request.path);
      try {
        await this.applyLines(workspace, request, null, { cached: true, reverse: false });
      } catch (error) {
        if (untracked) await staging.untrack([request.path], true).catch(() => undefined);
        throw error;
      }
    });
  }

  unstageLines(id: unknown, patch: unknown, base?: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const request = this.linePatch(workspace, patch);
      const compared = changeBase(base);
      await this.current(workspace, request, "index", compared);
      const tree = await workspace.repository.staging.base(compared);
      await this.applyLines(workspace, request, tree, { cached: true, reverse: true });
    });
  }

  discardLines(id: unknown, patch: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const request = this.linePatch(workspace, patch);
      const { staging } = workspace.repository;
      const untracked = await this.isUntracked(workspace, request.path);
      await this.current(workspace, request, "worktree", "head");
      if (untracked) await staging.intendToAdd(request.path);
      try {
        await this.applyLines(workspace, request, null, { cached: false, reverse: true });
      } finally {
        // What is left of the file stays untracked.
        if (untracked) await staging.untrack([request.path], true);
      }
    });
  }

  ignore(id: unknown, path: unknown, kind: unknown, location: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const target = workspace.path(path);
      if (!IGNORE_KINDS.includes(kind as IgnoreKind)) throw new Error("Invalid kind of rule.");
      const folder = location === "" ? "" : workspace.path(location);
      const rule = ignoreRule(kind as IgnoreKind, target, folder);
      if (rule === null)
        throw new Error(
          kind === "extension" && !extensionOf(target) ? `${target} has no extension.` : `${ignoreFile(folder)} can't ignore ${target}.`,
        );
      const file = ignoreFile(folder);
      let current: { content: string; hash: string | null } = { content: "", hash: null };
      try {
        current = await workspace.checkout.read(file);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const content = appendIgnoreRule(current.content, rule);
      if (content !== null) await workspace.checkout.write(file, content, current.hash);
    });
  }

  untrack(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace) => workspace.repository.staging.untrack(workspace.paths(paths), true));
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

  private linePatch(workspace: Workspace, value: unknown): LinePatch {
    const { path, oldPath, version, lines } = (value ?? {}) as Partial<Record<string, unknown>>;
    const relative = workspace.path(path);
    if (typeof version !== "string" || !/^[0-9a-f]{64}$/.test(version)) throw new Error("Invalid diff version.");
    const { original, modified } = (lines ?? {}) as Partial<Record<string, unknown>>;
    return {
      path: relative,
      ...(oldPath === undefined || oldPath === null ? {} : { oldPath: workspace.path(oldPath) }),
      version,
      lines: { original: lineRanges(original), modified: lineRanges(modified) },
    };
  }

  private async isUntracked(workspace: Workspace, path: string): Promise<boolean> {
    return (await workspace.repository.changes()).some((change) => change.path === path && change.index === "?");
  }

  /** Refuses lines chosen in a diff that is no longer current, or in one that has no lines. */
  private async current(workspace: Workspace, request: LinePatch, source: "worktree" | "index", base: ChangeBase): Promise<void> {
    const sides = await workspace.repository.diffSides(request.path, source, request.oldPath ?? request.path, TEXT_LIMIT, base);
    if (!sides || sides.some(isBinary)) throw new Error(`GitDesk can only stage ${request.path} as a whole.`);
    if (versionOf(sides) !== request.version)
      throw new Error(`${request.path} changed since its diff was shown. Look at the diff again and choose the lines anew.`);
  }

  /** Applies the chosen lines of git's diff of the file: of the working tree when `tree` is null, else of the index against it. */
  private async applyLines(workspace: Workspace, request: LinePatch, tree: string | null, target: PatchTarget): Promise<void> {
    const { staging } = workspace.repository;
    const diff = this.patches.parse(await staging.diff(request.path, request.oldPath ?? request.path, tree));
    const patch = this.patches.patch(diff, request.lines, target.reverse ? "reverse" : "forward");
    try {
      await staging.apply(patch, target);
    } catch (error) {
      throw new Error(`The lines no longer apply to ${request.path}. Look at the diff again. (${(error as Error).message})`, {
        cause: error,
      });
    }
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
