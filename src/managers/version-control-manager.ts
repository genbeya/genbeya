/** Staging, committing, history, branches and remotes of the checked-out repository. */
import type { VersionControlManagerContract } from "../contracts/manager-contracts";
import type {
  ChangeBase,
  Commit,
  CommitDetail,
  ConflictFile,
  Diff,
  DiffChange,
  DiffImages,
  ForcePushPlan,
  IgnoreKind,
  LinePatch,
  OperationOutcome,
  PushOutcome,
  PushPlan,
  PushRequest,
  RebasePlan,
  ResetPlan,
  ResetResult,
  PullComparison,
  RevisionFile,
  Stash,
  StashDetail,
} from "../contracts/model";
import { IGNORE_KINDS, isDefaultBranch } from "../contracts/model";
import { IMAGE_LIMIT, TEXT_LIMIT } from "../access/files/file-store";
import { isCommitId } from "../access/git/git-parsers";
import { compareBranches } from "../access/git/pull-access";
import { DIFF_OPTIONS, type PatchTarget } from "../access/git/staging-access";
import { isMissing } from "../access/hosts/host";
import type { FileDiff, PatchEngine } from "../engines/patch-engine";
import type { RebaseEngine } from "../engines/rebase-engine";
import { decodeLenient, decodeText, isBinary, sha256, sha256Bytes, toByteString } from "../utilities/bytes";
import { appendIgnoreRule, extensionOf, ignoreFile, ignoreRule } from "../utilities/gitignore";
import { imageType, imageUrl } from "../utilities/image-types";
import {
  changeBase,
  commitMessage,
  conflictResolution,
  diffSource,
  historyRange,
  linePatch,
  mergeOptions,
  plainRef,
  pushForce,
  rebaseSteps,
  refName,
  remoteDefinition,
  resetMode,
  resetState,
  revision,
  revisionList,
  stashOptions,
  syncAction,
  tagMessage,
} from "./version-control-arguments";
import type { Workspace, WorkspaceRegistry } from "./workspace";

/** The version of a diff's two sides; empty when they are too large to compare. */
const versionOf = (sides: readonly [Uint8Array, Uint8Array] | null): string =>
  // With the diff options: lines chosen in a diff that git found differently are refused too.
  sides ? sha256([DIFF_OPTIONS.join(" "), ...sides.map(sha256Bytes)].join(":")) : "";

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
      const from = diffSource(source);
      const compared = changeBase(base);
      for (let attempt = 1; ; attempt++) {
        const sides = await workspace.repository.diffSides(relative, from, old, TEXT_LIMIT, compared);
        // Too large to show is shown like binary: no line-by-line comparison.
        if (!sides || sides.some(isBinary))
          return {
            path: relative,
            binary: true,
            original: "",
            modified: "",
            version: versionOf(sides),
            ...(sides ? { sizes: [sides[0].length, sides[1].length] as const } : {}),
          };
        const changes =
          from === "worktree" || from === "index" ? await this.changesOf(workspace, relative, old, from, compared, sides) : null;
        // A file written meanwhile: read both again, so the changes are those of the sides shown.
        if (changes === undefined && attempt < 2) continue;
        return {
          path: relative,
          binary: false,
          original: decodeLenient(sides[0]),
          modified: decodeLenient(sides[1]),
          version: versionOf(sides),
          ...(changes ? { changes } : {}),
        };
      }
    });
  }

  diffImages(id: unknown, path: unknown, source: unknown, oldPath?: unknown, base?: unknown): Promise<DiffImages> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const old = oldPath === undefined || oldPath === null ? relative : workspace.path(oldPath);
      const type = imageType(relative);
      if (!type) throw new Error(`${relative} is not a supported image.`);
      const sides = await workspace.repository.diffSides(relative, diffSource(source), old, IMAGE_LIMIT, changeBase(base));
      if (!sides) throw new Error(`${relative} is too large to show.`);
      // A renamed image keeps the type of its old name on the old side.
      const types = [imageType(old) ?? type, type];
      const [original, modified] = sides.map((side, i) => (side.length ? imageUrl(types[i]!, side) : null)) as [
        string | null,
        string | null,
      ];
      return { original, modified };
    });
  }

  compare(id: unknown, source: unknown, target: unknown, revisions: unknown, exclude?: unknown): Promise<PullComparison> {
    return this.on(id, async (workspace) => {
      const asked = revisionList(revisions);
      const folder = exclude === undefined || exclude === null ? null : workspace.path(exclude);
      return compareBranches(workspace.repository.git, refName(source, "branch"), refName(target, "branch"), asked, folder);
    });
  }

  fileAt(id: unknown, at: unknown, path: unknown): Promise<RevisionFile> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const { commit, bytes } = await workspace.repository.fileAt(revision(at), relative, TEXT_LIMIT);
      return { commit, content: bytes && decodeText(bytes, relative) };
    });
  }

  /**
   * Git's changed lines between `sides`, from the diff staging patches;
   * undefined when that diff does not describe them, e.g. for a file git
   * shows only as a whole, or one written while it was read.
   */
  private async changesOf(
    workspace: Workspace,
    path: string,
    oldPath: string,
    source: "worktree" | "index",
    base: ChangeBase,
    sides: readonly [Uint8Array, Uint8Array],
  ): Promise<DiffChange[] | undefined> {
    const { staging } = workspace.repository;
    const tree = source === "index" ? await staging.base(base) : null;
    let diff: FileDiff;
    try {
      diff = this.patches.parse(await staging.diff(path, oldPath, tree));
    } catch {
      return undefined;
    }
    const [original, modified] = sides.map(toByteString) as [string, string];
    // An untracked file has no diff until the index knows it is coming; then it is all new.
    if (!diff.hunks.length && !diff.binary && original === "") return this.patches.creation(modified);
    return this.patches.describes(diff, original, modified) ? this.patches.changes(diff) : undefined;
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
      // A line break in a name would write rules of its own; POSIX hosts allow such names.
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(target))
        throw new Error("Genbeya can't write a .gitignore rule for a name with control characters.");
      const folder = location === "" ? "" : workspace.path(location);
      const rule = ignoreRule(kind as IgnoreKind, target, folder);
      if (rule === null)
        throw new Error(
          kind === "extension" && !extensionOf(target) ? `${target} has no extension.` : `${ignoreFile(folder)} can't ignore ${target}.`,
        );
      if (!(await workspace.checkout.host.kind(workspace.checkout.root, target))) throw new Error(`${target} does not exist.`);
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
    // Never forced: git refuses when the index holds changes found nowhere else.
    return this.on(id, (workspace) => workspace.repository.staging.untrack(workspace.paths(paths)));
  }

  commit(id: unknown, message: unknown, amend: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      await workspace.repository.commit(commitMessage(message), amend === true);
    });
  }

  lastCommitMessage(id: unknown): Promise<string> {
    return this.on(id, (workspace) => workspace.repository.lastCommitMessage());
  }

  log(id: unknown, skip: unknown, limit: unknown): Promise<readonly Commit[]> {
    return this.on(id, async (workspace) => {
      const range = historyRange(skip, limit);
      return workspace.repository.log(range.skip, range.limit);
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
      await workspace.repository.refs.createTag(tag, target, tagMessage(message));
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
      const checked = syncAction(action);
      const name = await this.remoteName(workspace, remote);
      const { branch } = await workspace.repository.head();
      await workspace.repository.sync(checked, name, branch);
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
      const lease = pushForce(force);
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
      const remote = remoteDefinition(name, url);
      await workspace.repository.setRemote(remote.name, remote.url);
    });
  }

  removeRemote(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (workspace) => workspace.repository.removeRemote(await this.remoteName(workspace, name)));
  }

  stash(id: unknown, options: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const checked = stashOptions(options);
      const changes = await workspace.repository.changes();
      if (!changes.some((change) => change.index !== "?" || checked.includeUntracked)) throw new Error("There are no changes to stash.");
      await workspace.repository.stashes.push(checked);
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
      return workspace.repository.operations.merge(source, mergeOptions(options));
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
      const chosen = rebaseSteps(steps);
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

  reset(id: unknown, hash: unknown, mode: unknown, expectedHead: unknown, expectedState?: unknown): Promise<ResetResult> {
    return this.starting(id, async (workspace) => {
      const checked = resetMode(mode);
      const target = await this.existingCommit(workspace, hash);
      if (!isCommitId(expectedHead)) throw new Error("Invalid commit ID.");
      const branch = await this.currentBranch(workspace);
      if ((await workspace.repository.git.objectId("HEAD")) !== expectedHead)
        throw new Error(`${branch} moved since you chose the reset. Look at it again first.`);
      const { resets } = workspace.repository;
      // Hard and keep rewrite files: changes made while the user looked at the plan would be lost unseen.
      if (checked === "hard" || checked === "keep") {
        const state = resetState(expectedState);
        if ((await resets.state(target)) !== state)
          throw new Error("Your uncommitted changes changed since you chose the reset. Look at it again first.");
      }
      return resets.reset(target, checked);
    });
  }

  undoLastCommit(id: unknown, expectedHead: unknown): Promise<ResetResult> {
    return this.starting(id, async (workspace) => {
      // The snapshot names HEAD by its short id.
      if (typeof expectedHead !== "string" || !/^[0-9a-f]{7,64}$/.test(expectedHead)) throw new Error("Invalid commit ID.");
      const branch = await this.currentBranch(workspace);
      if (!(await workspace.repository.git.objectId("HEAD"))?.startsWith(expectedHead))
        throw new Error(`${branch} moved since you chose to undo its last commit. Look at it again first.`);
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
      const resolved = conflictResolution(resolution);
      if (!(await workspace.repository.operations.conflictedPaths()).includes(relative)) throw new Error(`${relative} has no conflicts.`);
      await workspace.repository.operations.resolve(relative, resolved);
    });
  }

  private linePatch(workspace: Workspace, value: unknown): LinePatch {
    return linePatch(value, (path) => workspace.path(path));
  }

  private async isUntracked(workspace: Workspace, path: string): Promise<boolean> {
    return (await workspace.repository.changes()).some((change) => change.path === path && change.index === "?");
  }

  /** Refuses lines chosen in a diff that is no longer current, or in one that has no lines. */
  private async current(workspace: Workspace, request: LinePatch, source: "worktree" | "index", base: ChangeBase): Promise<void> {
    const sides = await workspace.repository.diffSides(request.path, source, request.oldPath ?? request.path, TEXT_LIMIT, base);
    if (!sides || sides.some(isBinary)) throw new Error(`Genbeya can only stage ${request.path} as a whole.`);
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
    if (commit.parents.length > 1) throw new Error("Genbeya does not cherry-pick or revert merge commits. Use the terminal instead.");
    return hash;
  }

  private async stashOf(workspace: Workspace, hash: unknown): Promise<Stash> {
    if (!isCommitId(hash)) throw new Error("Invalid stash.");
    return workspace.repository.stashes.find(hash);
  }

  private async branchName(workspace: Workspace, name: unknown): Promise<string> {
    const branch = refName(name, "branch");
    if (!(await workspace.repository.isValidBranchName(branch))) throw new Error(`"${branch}" is not a valid branch name.`);
    return plainRef(branch);
  }

  /** Refuses to force push to the branch everyone starts from, unless the user said they mean it. */
  private async notDefaultBranch(workspace: Workspace, remote: string, branch: string): Promise<void> {
    const known = await workspace.repository.pushes.defaultBranch(remote);
    if (!isDefaultBranch(branch, known)) return;
    throw new Error(
      (known
        ? `${branch} is the default branch of ${remote}. `
        : `Genbeya can't tell the default branch of ${remote}, and ${branch} may be it. `) +
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
    const tag = refName(name, "tag");
    if (!(await workspace.repository.refs.isValidTagName(tag))) throw new Error(`"${tag}" is not a valid tag name.`);
    return plainRef(tag);
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
