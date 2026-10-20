/**
 * Staging, committing, history, branches and remotes in the web demo, by
 * the rules of `VersionControlManager`: the same argument checks
 * (`version-control-arguments.ts`), the patch engine for staging lines and
 * the rebase engine for interactive rebases, on the in-memory repository.
 * Calls that would reach the network take a moment, as they would.
 */
import type { VersionControlManagerContract } from "../../contracts/manager-contracts";
import {
  IGNORE_KINDS,
  isDefaultBranch,
  type ChangeBase,
  type Commit,
  type CommitDetail,
  type ConflictFile,
  type Diff,
  type DiffChange,
  type DiffImages,
  type DiffSource,
  type ForcePushPlan,
  type IgnoreKind,
  type LinePatch,
  type OperationOutcome,
  type PushOutcome,
  type PushPlan,
  type PushRequest,
  type RebasePlan,
  type ResetPlan,
  type ResetResult,
  type StashDetail,
} from "../../contracts/model";
import { IMAGE_LIMIT, TEXT_LIMIT } from "../../access/files/file-store";
import { isCommitId } from "../../access/git/git-parsers";
import { REBASE_LIMIT } from "../../access/git/operation-access";
import { NOTHING_TO_AMEND } from "../../access/git/staging-access";
import { isMissing } from "../../access/hosts/host";
import { fileBytes } from "../../access/memory/file-bytes";
import { splitLines } from "../../access/memory/line-diff";
import type { MemoryRepository } from "../../access/memory/memory-repository";
import { unifiedDiff } from "../../access/memory/unified-diff";
import type { FileDiff, PatchEngine } from "../../engines/patch-engine";
import type { RebaseEngine } from "../../engines/rebase-engine";
import { encodeText, sha256 } from "../../utilities/bytes";
import { appendIgnoreRule, extensionOf, ignoreFile, ignoreRule } from "../../utilities/gitignore";
import { imageType, imageUrl } from "../../utilities/image-types";
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
  stashOptions,
  syncAction,
  tagMessage,
} from "../version-control-arguments";
import type { DemoRegistry, DemoWorkspace } from "./demo-workspace";

const short = (hash: string) => hash.slice(0, 7);

/** The version of a diff's two sides; empty when they are too large to compare. */
const versionOf = (sides: readonly [string, string] | null): string => (sides ? sha256(sides.map(sha256).join(":")) : "");

/**
 * `text` with the hunks of a patch applied, forward or in reverse; null
 * when the patch deletes the file. Context must match where the hunk says,
 * as `git apply` requires.
 */
export function applyPatch(text: string, diff: FileDiff, reverse: boolean): string | null {
  const lines = splitLines(text);
  const [removed, added] = reverse ? ["+", "-"] : ["-", "+"];
  const result: string[] = [];
  const written = (line: FileDiff["hunks"][number]["lines"][number]) => line.text + (line.noNewline ? "" : "\n");
  let at = 0;
  for (const hunk of diff.hunks) {
    const before = hunk.lines.filter((line) => line.kind !== added);
    const after = hunk.lines.filter((line) => line.kind !== removed);
    const start = reverse ? hunk.newStart : hunk.oldStart;
    const position = before.length ? start - 1 : start;
    if (position < at || before.some((line, i) => lines[position + i] !== written(line))) throw new Error("The patch does not apply.");
    result.push(...lines.slice(at, position), ...after.map(written));
    at = position + before.length;
  }
  result.push(...lines.slice(at));
  const deletes = reverse ? diff.oldName === null : diff.newName === null;
  return deletes && !result.length ? null : result.join("");
}

export class DemoVersionControlManager implements VersionControlManagerContract {
  constructor(
    private readonly registry: DemoRegistry,
    private readonly rebases: RebaseEngine,
    private readonly patches: PatchEngine,
    /** Waits as long as a request to the remote would take. */
    private readonly network: () => Promise<void>,
  ) {}

  private on<T>(id: unknown, operation: (workspace: DemoWorkspace, repository: MemoryRepository) => Promise<T> | T): Promise<T> {
    const workspace = this.registry.get(id);
    return workspace.exclusive(async () => operation(workspace, workspace.repository));
  }

  /** Like {@link on}, for operations that may not start while another is unfinished. */
  private starting<T>(id: unknown, operation: (workspace: DemoWorkspace, repository: MemoryRepository) => Promise<T> | T): Promise<T> {
    return this.on(id, (workspace, repository) => {
      const current = repository.operations.current();
      if (current) throw new Error(`Finish or abort the ${current.kind} first.`);
      if (repository.conflicts.size) throw new Error("Resolve the conflicted files first.");
      return operation(workspace, repository);
    });
  }

  diff(id: unknown, path: unknown, source: unknown, oldPath?: unknown, base?: unknown): Promise<Diff> {
    return this.on(id, (workspace, repository) => {
      const relative = workspace.path(path);
      const old = oldPath === undefined || oldPath === null ? relative : workspace.path(oldPath);
      const from = diffSource(source);
      const compared = changeBase(base);
      const sides = this.sides(repository, relative, from, old, compared);
      const [original, modified] = [sides[0] ?? "", sides[1] ?? ""];
      const sizes = [fileBytes(original).length, fileBytes(modified).length] as const;
      // Too large to show is shown like binary: no line-by-line comparison.
      if (sizes.some((size) => size > TEXT_LIMIT)) return { path: relative, binary: true, original: "", modified: "", version: "" };
      if ([original, modified].some((side) => side.includes("\0")))
        return { path: relative, binary: true, original: "", modified: "", version: versionOf([original, modified]), sizes };
      const changes = from === "worktree" || from === "index" ? this.changesOf(old, relative, sides) : null;
      return {
        path: relative,
        binary: false,
        original,
        modified,
        version: versionOf([original, modified]),
        ...(changes ? { changes } : {}),
      };
    });
  }

  diffImages(id: unknown, path: unknown, source: unknown, oldPath?: unknown, base?: unknown): Promise<DiffImages> {
    return this.on(id, (workspace, repository) => {
      const relative = workspace.path(path);
      const old = oldPath === undefined || oldPath === null ? relative : workspace.path(oldPath);
      const type = imageType(relative);
      if (!type) throw new Error(`${relative} is not a supported image.`);
      const sides = this.sides(repository, relative, diffSource(source), old, changeBase(base)).map((side) => fileBytes(side ?? ""));
      if (sides.some((side) => side.length > IMAGE_LIMIT)) throw new Error(`${relative} is too large to show.`);
      const types = [imageType(old) ?? type, type];
      const [original, modified] = sides.map((side, i) => (side.length ? imageUrl(types[i]!, side) : null)) as [
        string | null,
        string | null,
      ];
      return { original, modified };
    });
  }

  /** Both sides of a diff; a side without the file is undefined. */
  private sides(
    repository: MemoryRepository,
    path: string,
    source: DiffSource,
    oldPath: string,
    base: ChangeBase,
  ): [string | undefined, string | undefined] {
    if (source === "worktree") return [repository.index.get(path), repository.worktree.get(path)];
    if (source === "index") return [this.baseTree(repository, base).get(oldPath), repository.index.get(path)];
    if (!repository.commits.has(source.commit)) throw new Error(`Commit ${short(source.commit)} does not exist.`);
    const commit = repository.commits.get(source.commit);
    return [repository.treeOf(commit.parents[0] ?? null).get(oldPath), commit.tree.get(path)];
  }

  /** What staged changes are compared with: HEAD, or the commit an amend goes onto. */
  private baseTree(repository: MemoryRepository, base: ChangeBase) {
    const head = repository.headCommit();
    if (base === "head") return repository.headTree();
    if (!head) throw new Error(NOTHING_TO_AMEND);
    return repository.treeOf(repository.commits.get(head).parents[0] ?? null);
  }

  /** The diff staging patches, parsed as the patch engine reads Git's. */
  private fileDiff(oldPath: string, path: string, [before, after]: readonly [string | undefined, string | undefined]): FileDiff {
    return this.patches.parse(
      unifiedDiff(before === undefined ? null : oldPath, after === undefined ? null : path, before ?? "", after ?? ""),
    );
  }

  private changesOf(oldPath: string, path: string, sides: readonly [string | undefined, string | undefined]): DiffChange[] {
    return this.patches.changes(this.fileDiff(oldPath, path, sides));
  }

  stage(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => repository.add(workspace.paths(paths)));
  }

  unstage(id: unknown, paths: unknown, base?: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => {
      const valid = new Set(workspace.paths(paths));
      const compared = changeBase(base);
      // Renames come back with their old side.
      const tree = this.baseTree(repository, compared);
      const renames = compared === "head" ? repository.status() : repository.changedFiles(tree, repository.index);
      for (const change of renames) if (valid.has(change.path) && change.oldPath) valid.add(change.oldPath);
      repository.restoreStaged([...valid], tree);
    });
  }

  discard(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => {
      const wanted = new Set(workspace.paths(paths));
      for (const change of repository.status()) {
        if (!wanted.has(change.path)) continue;
        if (change.index === "?") repository.remove(change.path);
        else if (change.worktree !== " ") repository.restoreWorktree([change.path]);
      }
    });
  }

  stageLines(id: unknown, patch: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => {
      const request = linePatch(patch, (value) => workspace.path(value));
      const sides = this.current(repository, request, "worktree", "head");
      const result = this.applyLines(request, sides, "forward");
      if (result === null) repository.index.delete(request.path);
      else repository.index.set(request.path, result);
    });
  }

  unstageLines(id: unknown, patch: unknown, base?: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => {
      const request = linePatch(patch, (value) => workspace.path(value));
      const sides = this.current(repository, request, "index", changeBase(base));
      const result = this.applyLines(request, sides, "reverse");
      if (result === null) repository.index.delete(request.path);
      else repository.index.set(request.path, result);
    });
  }

  discardLines(id: unknown, patch: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => {
      const request = linePatch(patch, (value) => workspace.path(value));
      const sides = this.current(repository, request, "worktree", "head");
      const result = this.applyLines(request, sides, "reverse");
      if (result === null) repository.remove(request.path);
      else repository.write(request.path, result);
    });
  }

  /** The sides of the diff the lines were chosen in; refused when it changed since, or has no lines. */
  private current(repository: MemoryRepository, request: LinePatch, source: "worktree" | "index", base: ChangeBase) {
    const sides = this.sides(repository, request.path, source, request.oldPath ?? request.path, base);
    if (sides.some((side) => side?.includes("\0") || encodeText(side ?? "").length > TEXT_LIMIT))
      throw new Error(`Genbeya can only stage ${request.path} as a whole.`);
    if (versionOf([sides[0] ?? "", sides[1] ?? ""]) !== request.version)
      throw new Error(`${request.path} changed since its diff was shown. Look at the diff again and choose the lines anew.`);
    return sides;
  }

  /** The chosen lines applied: to the original side forward, to the modified side in reverse. */
  private applyLines(request: LinePatch, sides: [string | undefined, string | undefined], direction: "forward" | "reverse"): string | null {
    const diff = this.fileDiff(request.oldPath ?? request.path, request.path, sides);
    const patch = this.patches.parse(this.patches.patch(diff, request.lines, direction));
    const reverse = direction === "reverse";
    try {
      return applyPatch((reverse ? sides[1] : sides[0]) ?? "", patch, reverse);
    } catch (error) {
      throw new Error(`The lines no longer apply to ${request.path}. Look at the diff again. (${(error as Error).message})`, {
        cause: error,
      });
    }
  }

  ignore(id: unknown, path: unknown, kind: unknown, location: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const target = workspace.path(path);
      if (!IGNORE_KINDS.includes(kind as IgnoreKind)) throw new Error("Invalid kind of rule.");
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001f\u007f]/.test(target))
        throw new Error("Genbeya can't write a .gitignore rule for a name with control characters.");
      const folder = location === "" ? "" : workspace.path(location);
      const rule = ignoreRule(kind as IgnoreKind, target, folder);
      if (rule === null)
        throw new Error(
          kind === "extension" && !extensionOf(target) ? `${target} has no extension.` : `${ignoreFile(folder)} can't ignore ${target}.`,
        );
      if (!(await workspace.files.kind(target))) throw new Error(`${target} does not exist.`);
      const file = ignoreFile(folder);
      let current: { content: string; hash: string | null } = { content: "", hash: null };
      try {
        current = await workspace.files.read(file);
      } catch (error) {
        if (!isMissing(error)) throw error;
      }
      const content = appendIgnoreRule(current.content, rule);
      if (content !== null) await workspace.files.write(file, content, current.hash);
    });
  }

  untrack(id: unknown, paths: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => repository.untrack(workspace.paths(paths)));
  }

  commit(id: unknown, message: unknown, amend: unknown): Promise<void> {
    return this.on(id, (_, repository) => void repository.commit(commitMessage(message), amend === true));
  }

  lastCommitMessage(id: unknown): Promise<string> {
    return this.on(id, (_, repository) => {
      const head = repository.headCommit();
      return head ? repository.commits.get(head).message.trim() : "";
    });
  }

  log(id: unknown, skip: unknown, limit: unknown): Promise<readonly Commit[]> {
    return this.on(id, (_, repository) => {
      const range = historyRange(skip, limit);
      return repository.log(range.skip, range.limit);
    });
  }

  commitDetail(id: unknown, hash: unknown): Promise<CommitDetail> {
    return this.on(id, (_, repository) => {
      if (!isCommitId(hash)) throw new Error("Invalid commit ID.");
      if (!repository.commits.has(hash)) throw new Error(`Commit ${hash} does not exist.`);
      const commit = repository.commits.get(hash);
      const message = commit.message.trim();
      const body = message.includes("\n") ? message.slice(message.indexOf("\n")).trim() : "";
      return { commit: repository.describe(commit), body, files: repository.commitFiles(hash) };
    });
  }

  switchBranch(id: unknown, name: unknown): Promise<void> {
    return this.on(id, (_, repository) => {
      const branch = this.branchName(repository, name);
      if (repository.branches.has(branch)) return repository.switchTo({ branch });
      // A remote-only branch becomes a local one that tracks it.
      const tip = repository.tracking.get(branch);
      if (!tip) throw new Error(`There is no branch ${branch}.`);
      const { remote, branch: local } = this.remoteBranch(repository, branch);
      if (repository.branches.has(local)) throw new Error(`A branch named ${local} already exists.`);
      repository.checkout(repository.treeOf(tip), "switching");
      repository.branches.set(local, tip);
      repository.upstreams.set(local, { remote, branch: local });
      repository.head = { branch: local };
    });
  }

  createBranch(id: unknown, name: unknown, start?: unknown, checkout?: unknown): Promise<void> {
    return this.on(id, (_, repository) => {
      const branch = this.branchName(repository, name);
      if (repository.branches.has(branch)) throw new Error(`A branch named ${branch} already exists.`);
      const at = start === undefined || start === null ? repository.headCommit() : repository.resolve(this.revision(repository, start));
      if (checkout === false) {
        if (!at) throw new Error("There is no commit to start a branch from yet.");
        return repository.createBranch(branch, at);
      }
      if (at) {
        repository.checkout(repository.treeOf(at), "switching");
        repository.branches.set(branch, at);
      }
      repository.head = { branch };
    });
  }

  renameBranch(id: unknown, name: unknown, newName: unknown): Promise<void> {
    return this.on(id, (_, repository) =>
      repository.renameBranch(this.localBranch(repository, name), this.branchName(repository, newName)),
    );
  }

  deleteBranch(id: unknown, name: unknown, force: unknown): Promise<boolean> {
    return this.on(id, (_, repository) => repository.deleteBranch(this.localBranch(repository, name), force === true));
  }

  deleteRemoteBranch(id: unknown, name: unknown): Promise<void> {
    return this.on(id, async (_, repository) => {
      const { remote, branch } = this.remoteBranch(repository, name);
      await this.network();
      repository.sync.deleteBranch(remote, branch);
    });
  }

  setUpstream(id: unknown, branch: unknown, upstream: unknown): Promise<void> {
    return this.on(id, (_, repository) => {
      const local = this.localBranch(repository, branch);
      repository.upstreams.set(local, this.remoteBranch(repository, upstream));
    });
  }

  createTag(id: unknown, name: unknown, commit: unknown, message: unknown): Promise<void> {
    return this.on(id, (_, repository) => {
      const tag = this.tagName(repository, name);
      const target = repository.resolve(this.revision(repository, commit));
      repository.createTag(tag, target, tagMessage(message));
    });
  }

  deleteTag(id: unknown, name: unknown): Promise<void> {
    return this.on(id, (_, repository) => void repository.tags.delete(this.existingTag(repository, name)));
  }

  pushTag(id: unknown, name: unknown, remote: unknown): Promise<void> {
    return this.on(id, async (_, repository) => {
      const tag = this.existingTag(repository, name);
      const to = this.remoteName(repository, remote);
      await this.network();
      repository.sync.pushTag(to, tag);
    });
  }

  deleteRemoteTag(id: unknown, name: unknown, remote: unknown): Promise<void> {
    return this.on(id, async (_, repository) => {
      const tag = this.tagName(repository, name);
      const from = this.remoteName(repository, remote);
      await this.network();
      repository.sync.deleteTag(from, tag);
    });
  }

  sync(id: unknown, action: unknown, remote: unknown): Promise<void> {
    return this.on(id, async (_, repository) => {
      const checked = syncAction(action);
      const name = this.remoteName(repository, remote);
      const branch = repository.currentBranch();
      await this.network();
      if (checked === "fetch") return repository.sync.fetch(name);
      if (!branch) throw new Error("Switch to a branch first.");
      if (checked === "pull") repository.sync.pull(name, branch);
      else repository.sync.pushBranch(name, branch);
    });
  }

  pushPlan(id: unknown, branch: unknown): Promise<PushPlan> {
    return this.on(id, (_, repository) => repository.sync.plan(this.localBranch(repository, branch)));
  }

  forcePushPlan(id: unknown, branch: unknown, remote: unknown, remoteBranch: unknown): Promise<ForcePushPlan> {
    return this.on(id, (_, repository) =>
      repository.sync.forcePlan(
        this.localBranch(repository, branch),
        this.remoteName(repository, remote),
        this.pushedBranchName(repository, remoteBranch),
      ),
    );
  }

  push(id: unknown, request: unknown): Promise<PushOutcome> {
    return this.on(id, async (_, repository) => {
      const { branch, remote, remoteBranch, setUpstream, force } = (request ?? {}) as Partial<Record<string, unknown>>;
      if (typeof setUpstream !== "boolean") throw new Error("Invalid push.");
      const lease = pushForce(force);
      const checked: PushRequest = {
        branch: this.localBranch(repository, branch),
        remote: this.remoteName(repository, remote),
        remoteBranch: this.pushedBranchName(repository, remoteBranch),
        setUpstream,
      };
      if (lease && !lease.defaultBranch) this.notDefaultBranch(repository, checked.remote, checked.remoteBranch);
      await this.network();
      return repository.sync.push({ ...checked, ...(lease ? { force: { expected: lease.expected } } : {}) });
    });
  }

  setRemote(id: unknown, name: unknown, url: unknown): Promise<void> {
    return this.on(id, (_, repository) => {
      const remote = remoteDefinition(name, url);
      repository.sync.set(remote.name, remote.url);
    });
  }

  removeRemote(id: unknown, name: unknown): Promise<void> {
    return this.on(id, (_, repository) => repository.sync.remove(this.remoteName(repository, name)));
  }

  stash(id: unknown, options: unknown): Promise<void> {
    return this.on(id, (_, repository) => {
      const checked = stashOptions(options);
      if (!repository.status().some((change) => change.index !== "?" || checked.includeUntracked))
        throw new Error("There are no changes to stash.");
      repository.stashes.push(checked.message, checked);
    });
  }

  stashDetail(id: unknown, hash: unknown): Promise<StashDetail> {
    return this.on(id, (_, repository) => repository.stashes.detail(this.stashOf(repository, hash)));
  }

  applyStash(id: unknown, hash: unknown, pop: unknown): Promise<OperationOutcome> {
    return this.starting(id, (_, repository) => repository.stashes.apply(this.stashOf(repository, hash), pop === true));
  }

  dropStash(id: unknown, hash: unknown): Promise<void> {
    return this.on(id, (_, repository) => repository.stashes.drop(this.stashOf(repository, hash)));
  }

  branchFromStash(id: unknown, hash: unknown, name: unknown): Promise<void> {
    return this.on(id, (_, repository) => repository.stashes.branch(this.stashOf(repository, hash), this.branchName(repository, name)));
  }

  merge(id: unknown, ref: unknown, options: unknown): Promise<OperationOutcome> {
    return this.starting(id, (_, repository) => {
      const source = this.revision(repository, ref);
      return repository.operations.merge(source, repository.resolve(source), mergeOptions(options));
    });
  }

  rebase(id: unknown, onto: unknown, autostash: unknown): Promise<OperationOutcome> {
    return this.starting(id, (_, repository) => {
      const target = repository.resolve(this.revision(repository, onto));
      this.cleanUnless(repository, autostash);
      return repository.operations.rebase(target, autostash === true);
    });
  }

  pullRebase(id: unknown, remote: unknown, autostash: unknown): Promise<OperationOutcome> {
    return this.starting(id, async (_, repository) => {
      const name = this.remoteName(repository, remote);
      this.cleanUnless(repository, autostash);
      const branch = repository.currentBranch();
      if (!branch) throw new Error("Switch to a branch first.");
      await this.network();
      return repository.sync.pullRebase(name, branch, autostash === true);
    });
  }

  rebasePlan(id: unknown, base: unknown): Promise<RebasePlan> {
    return this.on(id, (_, repository) => this.plan(repository, repository.resolve(this.revision(repository, base))));
  }

  private plan(repository: MemoryRepository, base: string): RebasePlan {
    const head = repository.headCommit();
    if (!head) throw new Error("There is no commit to rebase yet.");
    const count = repository.commits.range(base, head).length;
    if (count > REBASE_LIMIT) throw new Error(`That rewrites ${count} commits; Genbeya rebases up to ${REBASE_LIMIT} at a time.`);
    return repository.operations.plan(base);
  }

  rebaseInteractive(id: unknown, base: unknown, steps: unknown, autostash: unknown): Promise<OperationOutcome> {
    return this.starting(id, (_, repository) => {
      const head = repository.headCommit();
      if (!isCommitId(base) || !head || !repository.commits.has(base) || !repository.commits.isAncestor(base, head))
        throw new Error("Choose a commit of the current branch.");
      const chosen = rebaseSteps(steps);
      this.cleanUnless(repository, autostash);
      const todo = this.rebases.todo(this.plan(repository, base).commits, chosen);
      return repository.operations.rebaseInteractive(base, todo, autostash === true);
    });
  }

  cherryPick(id: unknown, hash: unknown): Promise<OperationOutcome> {
    return this.starting(id, (_, repository) => {
      const commit = this.singleParent(repository, hash);
      const head = repository.headCommit();
      if (head && repository.commits.isAncestor(commit, head))
        throw new Error(`${short(commit)} is already on ${repository.currentBranch() ?? "the checked-out commit"}.`);
      return repository.operations.cherryPick(commit);
    });
  }

  revert(id: unknown, hash: unknown): Promise<OperationOutcome> {
    return this.starting(id, (_, repository) => repository.operations.revert(this.singleParent(repository, hash)));
  }

  resetPlan(id: unknown, hash: unknown): Promise<ResetPlan> {
    return this.starting(id, (_, repository) => {
      const target = this.existingCommit(repository, hash);
      const head = repository.headCommit();
      if (!head) throw new Error("There is no commit to reset yet.");
      const { branch, upstream } = repository.headState();
      if (!branch) throw new Error("Switch to a branch first.");
      const tip = upstream ? repository.tracking.get(upstream) : undefined;
      const base = tip ? repository.commits.mergeBase(head, tip) : null;
      return {
        branch,
        head,
        target,
        commits: repository.commits.range(target, head).length,
        upstream,
        pushed: base ? repository.commits.range(target, base).length : 0,
        uncommitted: repository
          .status()
          .filter((change) => change.index !== "?")
          .map((change) => change.path),
        overwritten: repository.overwrittenBy(target),
        state: this.resetStateOf(repository, target),
      };
    });
  }

  /** A fingerprint of what a hard or keep reset to `target` can lose: the uncommitted changes and the files it would overwrite. */
  private resetStateOf(repository: MemoryRepository, target: string): string {
    const changed = repository.status().filter((change) => change.index !== "?");
    const overwritten = repository.overwrittenBy(target);
    const contents = [...changed.map((change) => change.path), ...overwritten].map((path) => [
      path,
      repository.index.get(path),
      repository.worktree.get(path),
    ]);
    return sha256(JSON.stringify({ changed, overwritten, contents }));
  }

  reset(id: unknown, hash: unknown, mode: unknown, expectedHead: unknown, expectedState?: unknown): Promise<ResetResult> {
    return this.starting(id, (_, repository) => {
      const checked = resetMode(mode);
      const target = this.existingCommit(repository, hash);
      if (!isCommitId(expectedHead)) throw new Error("Invalid commit ID.");
      const branch = this.currentBranch(repository);
      const from = repository.headCommit();
      if (from !== expectedHead) throw new Error(`${branch} moved since you chose the reset. Look at it again first.`);
      if (checked === "hard" || checked === "keep") {
        const state = resetState(expectedState);
        if (this.resetStateOf(repository, target) !== state)
          throw new Error("Your uncommitted changes changed since you chose the reset. Look at it again first.");
      }
      repository.reset(target, checked);
      return { from, to: target };
    });
  }

  undoLastCommit(id: unknown, expectedHead: unknown): Promise<ResetResult> {
    return this.starting(id, (_, repository) => {
      if (typeof expectedHead !== "string" || !/^[0-9a-f]{7,64}$/.test(expectedHead)) throw new Error("Invalid commit ID.");
      const branch = this.currentBranch(repository);
      const from = repository.headCommit();
      if (!from?.startsWith(expectedHead))
        throw new Error(`${branch} moved since you chose to undo its last commit. Look at it again first.`);
      const { parents } = repository.commits.get(from);
      if (!parents.length) throw new Error("The last commit is the first one; there is nothing before it to go back to.");
      if (parents.length > 1) throw new Error("The last commit is a merge. Reset the branch from History to choose where it goes.");
      repository.reset(parents[0]!, "soft");
      return { from, to: parents[0]! };
    });
  }

  continueOperation(id: unknown): Promise<OperationOutcome> {
    return this.on(id, (_, repository) => repository.operations.continue());
  }

  skipOperation(id: unknown): Promise<OperationOutcome> {
    return this.on(id, (_, repository) => repository.operations.skip());
  }

  abortOperation(id: unknown): Promise<void> {
    return this.on(id, (_, repository) => repository.operations.abort());
  }

  conflict(id: unknown, path: unknown): Promise<ConflictFile> {
    return this.on(id, (workspace, repository) => repository.operations.conflict(workspace.path(path)));
  }

  resolveConflict(id: unknown, path: unknown, resolution: unknown): Promise<void> {
    return this.on(id, (workspace, repository) => {
      const relative = workspace.path(path);
      const resolved = conflictResolution(resolution);
      if (!repository.conflicts.has(relative)) throw new Error(`${relative} has no conflicts.`);
      repository.operations.resolve(relative, resolved);
    });
  }

  /** Rewriting history needs a clean working tree, unless the changes are stashed meanwhile. */
  private cleanUnless(repository: MemoryRepository, autostash: unknown): void {
    if (autostash !== true && repository.hasChanges()) throw new Error("Commit or stash your changes first.");
  }

  /** A commit with one parent: picking or reverting a merge needs to know which side to follow. */
  private singleParent(repository: MemoryRepository, hash: unknown): string {
    if (!isCommitId(hash)) throw new Error("Invalid commit ID.");
    if (!repository.commits.has(hash)) throw new Error(`Commit ${hash} does not exist.`);
    if (repository.commits.get(hash).parents.length > 1)
      throw new Error("Genbeya does not cherry-pick or revert merge commits. Use the terminal instead.");
    return hash;
  }

  private stashOf(repository: MemoryRepository, hash: unknown): string {
    if (!isCommitId(hash)) throw new Error("Invalid stash.");
    return repository.stashes.find(hash).commit;
  }

  private branchName(repository: MemoryRepository, name: unknown): string {
    const branch = refName(name, "branch");
    if (!repository.isValidBranchName(branch)) throw new Error(`"${branch}" is not a valid branch name.`);
    return plainRef(branch);
  }

  /** Refuses to force push to the branch everyone starts from, unless the user said they mean it. */
  private notDefaultBranch(repository: MemoryRepository, remote: string, branch: string): void {
    const known = repository.sync.defaultBranch(remote);
    if (!isDefaultBranch(branch, known)) return;
    throw new Error(
      (known
        ? `${branch} is the default branch of ${remote}. `
        : `Genbeya can't tell the default branch of ${remote}, and ${branch} may be it. `) +
        "Force pushing to it rewrites the history everyone starts from; confirm that you mean it.",
    );
  }

  private pushedBranchName(repository: MemoryRepository, name: unknown): string {
    if (name === "HEAD" || (typeof name === "string" && name.includes("@{"))) throw new Error("Invalid branch name.");
    return this.branchName(repository, name);
  }

  private currentBranch(repository: MemoryRepository): string {
    const branch = repository.currentBranch();
    if (!branch) throw new Error("Switch to a branch first.");
    return branch;
  }

  private existingCommit(repository: MemoryRepository, hash: unknown): string {
    if (!isCommitId(hash) || !repository.commits.has(hash)) throw new Error("Choose a commit.");
    return hash;
  }

  private localBranch(repository: MemoryRepository, name: unknown): string {
    if (typeof name !== "string" || !repository.branches.has(name)) throw new Error("Choose a branch.");
    return plainRef(name);
  }

  /** A remote-tracking branch such as `origin/feature`, split into its remote and the branch there. */
  private remoteBranch(repository: MemoryRepository, name: unknown): { remote: string; branch: string } {
    if (typeof name !== "string" || !repository.tracking.has(name)) throw new Error("Choose a remote branch.");
    plainRef(name);
    const remote = repository.sync
      .names()
      .filter((candidate) => name.startsWith(`${candidate}/`))
      .sort((a, b) => b.length - a.length)[0];
    if (!remote) throw new Error(`No remote is configured for ${name}.`);
    return { remote, branch: name.slice(remote.length + 1) };
  }

  private tagName(repository: MemoryRepository, name: unknown): string {
    const tag = refName(name, "tag");
    if (!repository.isValidTagName(tag)) throw new Error(`"${tag}" is not a valid tag name.`);
    return plainRef(tag);
  }

  private existingTag(repository: MemoryRepository, name: unknown): string {
    if (typeof name !== "string" || !repository.tags.has(name)) throw new Error("Choose a tag.");
    return plainRef(name);
  }

  /** A commit ID, or the name of a branch, remote branch or tag. */
  private revision(repository: MemoryRepository, value: unknown): string {
    if (isCommitId(value) && repository.commits.has(value)) return value;
    if (typeof value === "string" && (repository.branches.has(value) || repository.tracking.has(value) || repository.tags.has(value)))
      return plainRef(value);
    throw new Error("Choose a branch, tag or commit.");
  }

  private remoteName(repository: MemoryRepository, name: unknown): string {
    if (typeof name !== "string" || !repository.remotes.has(name)) throw new Error("Choose a configured remote.");
    return name;
  }
}
