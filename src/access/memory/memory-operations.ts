/**
 * Operations that can stop for conflicts in the in-memory repository:
 * merges, rebases (plain and interactive), cherry-picks and reverts, the
 * conflicted files they leave, and continuing, skipping or aborting them.
 * Each applies a three-way merge of trees; text files merge line by line
 * with Git's conflict markers.
 */
import type { ConflictFile, ConflictResolution, Operation, OperationOutcome, RebaseCommit, RebasePlan } from "../../contracts/model";
import type { RebaseTodo } from "../../contracts/rebase-todo";
import { sameTree, subjectOf, type CommitObject, type Signature, type Tree } from "./commits";
import { mergeText, type MergeLabels } from "./merge-text";
import type { MemoryRepository, Stages } from "./memory-repository";
import type { StashEntry } from "./memory-stashes";

/** One step of a rebase: a commit to replay, to fold into the one before, or to leave out; or a new message for the commit just made. */
export type RebaseStep =
  { readonly command: "pick" | "fixup" | "drop"; readonly hash: string } | { readonly command: "amend"; readonly message: string };

export interface RebaseState {
  readonly kind: "rebase";
  /** The branch being rebased; null for a detached HEAD. */
  readonly branch: string | null;
  readonly onto: string;
  /** Where HEAD was, for aborting. */
  readonly original: string;
  readonly steps: RebaseStep[];
  /** Steps taken, counting the one stopped at, of `total`. */
  done: number;
  readonly total: number;
  /** The step that stopped for conflicts. */
  current: RebaseStep | null;
  /** Whether the last pick made a commit, which a following new message then amends. */
  picked: boolean;
  /** Uncommitted changes set aside meanwhile. */
  readonly autostash: StashEntry | null;
}

export type OperationState =
  | { readonly kind: "merge"; readonly theirs: string; readonly message: string; readonly touched: readonly string[] }
  | {
      readonly kind: "cherry-pick" | "revert";
      readonly commit: string;
      readonly message: string;
      readonly author: Signature;
      readonly touched: readonly string[];
    }
  | RebaseState;

/** A three-way merge of trees: the files that merged, and those that conflict with their stages and working-tree text. */
export interface TreeMerge {
  readonly tree: Map<string, string>;
  readonly conflicts: Map<string, { readonly stages: Stages; readonly text: string | null }>;
}

/** Merges `ours` and `theirs`, which both come from `base`. */
export function mergeTrees(base: Tree, ours: Tree, theirs: Tree, labels: MergeLabels): TreeMerge {
  const tree = new Map<string, string>();
  const conflicts: TreeMerge["conflicts"] = new Map();
  for (const path of new Set([...base.keys(), ...ours.keys(), ...theirs.keys()])) {
    const [b, o, t] = [base.get(path), ours.get(path), theirs.get(path)];
    const stages: Stages = {
      ...(b === undefined ? {} : { base: b }),
      ...(o === undefined ? {} : { ours: o }),
      ...(t === undefined ? {} : { theirs: t }),
    };
    let result: string | undefined;
    if (o === t || b === t) result = o;
    else if (b === o) result = t;
    else if (o !== undefined && t !== undefined) {
      const merged = mergeText(b ?? "", o, t, labels);
      if (merged.conflicts) {
        conflicts.set(path, { stages, text: merged.text });
        continue;
      }
      result = merged.text;
    } else {
      // Deleted on one side, changed on the other: the changed version stays in the working tree.
      conflicts.set(path, { stages, text: o ?? t! });
      continue;
    }
    if (result !== undefined) tree.set(path, result);
  }
  return { tree, conflicts };
}

const short = (hash: string) => hash.slice(0, 7);

export class MemoryOperations {
  constructor(private readonly repository: MemoryRepository) {}

  /** What is in progress, as the snapshot shows it. */
  current(): Operation | null {
    const operation = this.repository.operation;
    if (!operation) return null;
    const branch = this.repository.currentBranch();
    const none = { step: null, steps: null };
    switch (operation.kind) {
      case "merge":
        return {
          kind: "merge",
          source: /^Merge (?:remote-tracking branch|branch|tag|commit) '([^']+)'/.exec(operation.message)?.[1] ?? short(operation.theirs),
          target: branch,
          ...none,
        };
      case "cherry-pick":
        return { kind: "cherry-pick", source: subjectOf(operation.message), target: branch, ...none };
      case "revert":
        return { kind: "revert", source: subjectOf(this.repository.commits.get(operation.commit).message), target: branch, ...none };
      case "rebase":
        return {
          kind: "rebase",
          source: operation.branch ?? short(operation.original),
          target: this.nameOf(operation.onto),
          step: operation.done,
          steps: operation.total,
        };
    }
  }

  /** A branch, remote-tracking branch or tag at `hash`, else its short form. */
  private nameOf(hash: string): string {
    const { branches, tracking, tags } = this.repository;
    const names = [
      ...[...branches]
        .filter(([, tip]) => tip === hash)
        .map(([name]) => name)
        .sort(),
      ...[...tracking]
        .filter(([, tip]) => tip === hash)
        .map(([name]) => name)
        .sort(),
      ...[...tags]
        .filter(([, tag]) => tag.commit === hash)
        .map(([name]) => name)
        .sort(),
    ];
    return names[0] ?? short(hash);
  }

  conflictedPaths(): string[] {
    return [...this.repository.conflicts.keys()].sort();
  }

  /** Merges a branch, tag or commit (`ref`, which names `hash`) into HEAD. */
  merge(ref: string, hash: string, { noFastForward, message }: { noFastForward: boolean; message: string }): OperationOutcome {
    const repository = this.repository;
    const head = repository.headCommit();
    if (!head) {
      repository.checkout(repository.treeOf(hash), "the merge");
      repository.setHead(hash);
      return "done";
    }
    if (repository.commits.isAncestor(hash, head)) return "done";
    if (repository.commits.isAncestor(head, hash) && !noFastForward) {
      repository.checkout(repository.treeOf(hash), "the merge");
      repository.setHead(hash);
      return "done";
    }
    const base = repository.commits.mergeBase(head, hash);
    if (!base)
      throw new Error(
        `${ref} has no history in common with ${repository.currentBranch() ?? "HEAD"}; Genbeya doesn't merge unrelated histories.`,
      );
    this.refuseStaged("merge");
    const text = message || this.mergeMessage(ref);
    const touched = this.apply(repository.treeOf(base), repository.treeOf(hash), { ours: "HEAD", theirs: ref }, "the merge");
    if (repository.conflicts.size) {
      repository.operation = { kind: "merge", theirs: hash, message: text, touched };
      return "stopped";
    }
    repository.setHead(repository.writeCommit(repository.indexTree(), [head, hash], text).hash);
    return "done";
  }

  /** Git's message for merging `ref`. */
  private mergeMessage(ref: string): string {
    const repository = this.repository;
    const into = repository.currentBranch();
    const suffix = into && into !== "main" && into !== "master" ? ` into ${into}` : "";
    if (repository.branches.has(ref)) return `Merge branch '${ref}'${suffix}`;
    if (repository.tracking.has(ref)) return `Merge remote-tracking branch '${ref}'${suffix}`;
    if (repository.tags.has(ref)) return `Merge tag '${ref}'${suffix}`;
    return `Merge commit '${ref}'${suffix}`;
  }

  /** The commits a rebase onto `base` rewrites, oldest first, and the remote branches that already have some. */
  plan(base: string): RebasePlan {
    const repository = this.repository;
    const head = repository.headCommit()!;
    const commits: RebaseCommit[] = repository.commits
      .range(base, head)
      .reverse()
      .map((commit) => ({
        hash: commit.hash,
        subject: subjectOf(commit.message),
        message: commit.message.trim(),
        author: commit.author.name,
        date: commit.author.date,
        merge: commit.parents.length > 1,
      }));
    const first = commits[0]?.hash;
    const pushed = first
      ? [...repository.tracking]
          .filter(([, tip]) => repository.commits.isAncestor(first, tip))
          .map(([name]) => name)
          .sort()
      : [];
    return { base, commits, pushed };
  }

  /** Replays the commits of HEAD that `onto` lacks on top of it; merges are left out, as Git does. */
  rebase(onto: string, autostash: boolean): OperationOutcome {
    const repository = this.repository;
    const head = repository.headCommit();
    if (!head) throw new Error("There is no commit to rebase yet.");
    if (repository.commits.isAncestor(onto, head)) return "done";
    if (repository.commits.isAncestor(head, onto)) {
      const stash = this.setAside(autostash);
      repository.checkout(repository.treeOf(onto), "the rebase");
      repository.setHead(onto);
      if (stash) repository.stashes.restore(stash);
      return "done";
    }
    const steps: RebaseStep[] = repository.commits
      .range(onto, head)
      .reverse()
      .filter((commit) => commit.parents.length < 2)
      .map((commit) => ({ command: "pick", hash: commit.hash }));
    return this.startRebase(onto, steps, autostash);
  }

  /** Rewrites the commits after `base` as the todo says (see the rebase engine). */
  rebaseInteractive(base: string, { lines, messages }: RebaseTodo, autostash: boolean): OperationOutcome {
    const steps: RebaseStep[] = lines.map((line) =>
      line.command === "amend" ? { command: "amend", message: messages[line.message]! } : { command: line.command, hash: line.hash },
    );
    return this.startRebase(base, steps, autostash);
  }

  private startRebase(onto: string, steps: RebaseStep[], autostash: boolean): OperationOutcome {
    const repository = this.repository;
    const original = repository.headCommit()!;
    const branch = repository.currentBranch();
    const stash = this.setAside(autostash);
    repository.checkout(repository.treeOf(onto), "the rebase");
    repository.head = { detached: onto };
    repository.operation = {
      kind: "rebase",
      branch,
      onto,
      original,
      steps,
      done: 0,
      total: steps.filter((step) => step.command !== "amend").length,
      current: null,
      picked: false,
      autostash: stash,
    };
    return this.runRebase();
  }

  /** Uncommitted changes stashed for the time of an operation, if asked to; without, they stop it. */
  private setAside(autostash: boolean): StashEntry | null {
    const repository = this.repository;
    if (!repository.hasChanges()) return null;
    if (!autostash) throw new Error("Commit or stash your changes first.");
    return repository.stashes.save("autostash", { includeUntracked: false, keepIndex: false });
  }

  /** Takes the rebase's steps until one conflicts or none are left. */
  private runRebase(): OperationOutcome {
    const repository = this.repository;
    const state = repository.operation as RebaseState;
    for (let step = state.steps.shift(); step; step = state.steps.shift()) {
      if (step.command === "amend") {
        if (state.picked) this.amendMessage(step.message);
        continue;
      }
      state.done++;
      if (step.command === "drop") continue;
      const commit = repository.commits.get(step.hash);
      this.apply(repository.treeOf(commit.parents[0] ?? null), commit.tree, this.pickLabels(commit), "the rebase");
      if (repository.conflicts.size) {
        state.current = step;
        return "stopped";
      }
      this.commitStep(state, step);
    }
    if (state.branch) {
      repository.branches.set(state.branch, repository.headCommit()!);
      repository.head = { branch: state.branch };
    }
    repository.operation = null;
    if (state.autostash) repository.stashes.restore(state.autostash);
    return "done";
  }

  /** Commits what a pick or fixup left in the index: a new commit, or the last one amended; nothing when it changed nothing. */
  private commitStep(state: RebaseState, step: Extract<RebaseStep, { hash: string }>): void {
    const repository = this.repository;
    const commit = repository.commits.get(step.hash);
    const tree = repository.indexTree();
    const head = repository.commits.get(repository.headCommit()!);
    state.current = null;
    if (sameTree(tree, head.tree)) {
      if (step.command === "pick") state.picked = false;
      return;
    }
    if (step.command === "pick") {
      repository.setHead(repository.writeCommit(tree, [head.hash], commit.message, commit.author).hash);
      state.picked = true;
    } else repository.setHead(repository.writeCommit(tree, head.parents, head.message, head.author).hash);
  }

  private amendMessage(message: string): void {
    const repository = this.repository;
    const head = repository.commits.get(repository.headCommit()!);
    repository.setHead(repository.writeCommit(head.tree, head.parents, message, head.author).hash);
  }

  private pickLabels(commit: CommitObject): MergeLabels {
    return { ours: "HEAD", theirs: `${short(commit.hash)} (${subjectOf(commit.message)})` };
  }

  /** Applies a commit's changes as a new commit, keeping its author and message. */
  cherryPick(hash: string): OperationOutcome {
    const repository = this.repository;
    const commit = repository.commits.get(hash);
    this.refuseStaged("cherry-pick");
    const touched = this.apply(repository.treeOf(commit.parents[0] ?? null), commit.tree, this.pickLabels(commit), "the cherry-pick");
    if (repository.conflicts.size) {
      repository.operation = { kind: "cherry-pick", commit: hash, message: commit.message, author: commit.author, touched };
      return "stopped";
    }
    if (sameTree(repository.index, repository.headTree())) throw new Error("Its changes are already on this branch; nothing was picked.");
    repository.setHead(repository.writeCommit(repository.indexTree(), [repository.headCommit()!], commit.message, commit.author).hash);
    return "done";
  }

  /** Undoes a commit's changes with a new commit. */
  revert(hash: string): OperationOutcome {
    const repository = this.repository;
    const commit = repository.commits.get(hash);
    this.refuseStaged("revert");
    const subject = subjectOf(commit.message);
    const message = `Revert "${subject}"\n\nThis reverts commit ${hash}.`;
    const labels = { ours: "HEAD", theirs: `parent of ${short(hash)} (${subject})` };
    const touched = this.apply(commit.tree, repository.treeOf(commit.parents[0] ?? null), labels, "the revert");
    if (repository.conflicts.size) {
      repository.operation = { kind: "revert", commit: hash, message, author: repository.signature(), touched };
      return "stopped";
    }
    if (sameTree(repository.index, repository.headTree()))
      throw new Error("Its changes are undone on this branch already; nothing was reverted.");
    repository.setHead(repository.writeCommit(repository.indexTree(), [repository.headCommit()!], message).hash);
    return "done";
  }

  /** Continues once the conflicts are resolved; "stopped" when the next commit of a rebase conflicts. */
  continue(): OperationOutcome {
    const repository = this.repository;
    const operation = this.require();
    const left = repository.conflicts.size;
    if (left) throw new Error(`Resolve the ${left === 1 ? "conflicted file" : `${left} conflicted files`} first.`);
    const head = repository.headCommit()!;
    switch (operation.kind) {
      case "merge":
        repository.setHead(repository.writeCommit(repository.indexTree(), [head, operation.theirs], operation.message).hash);
        break;
      case "cherry-pick":
      case "revert":
        // A resolution that undid every change leaves nothing to commit.
        if (!sameTree(repository.index, repository.headTree()))
          repository.setHead(repository.writeCommit(repository.indexTree(), [head], operation.message, operation.author).hash);
        break;
      case "rebase":
        if (operation.current?.command === "pick" || operation.current?.command === "fixup") this.commitStep(operation, operation.current);
        return this.runRebase();
    }
    repository.operation = null;
    return "done";
  }

  /** Leaves out the commit a rebase, cherry-pick or revert stopped at. */
  skip(): OperationOutcome {
    const repository = this.repository;
    const operation = this.require();
    if (operation.kind === "merge") throw new Error("A merge cannot skip anything. Abort it instead.");
    this.restore(this.touchedBy(operation));
    if (operation.kind !== "rebase") {
      repository.operation = null;
      return "done";
    }
    operation.current = null;
    return this.runRebase();
  }

  /** Goes back to before the operation began. */
  abort(): void {
    const repository = this.repository;
    const operation = this.require();
    if (operation.kind !== "rebase") {
      this.restore(this.touchedBy(operation));
      repository.operation = null;
      return;
    }
    this.restore(this.touchedBy(operation));
    repository.checkout(repository.treeOf(operation.original), "aborting the rebase");
    repository.head = operation.branch ? { branch: operation.branch } : { detached: operation.original };
    repository.operation = null;
    if (operation.autostash) repository.stashes.restore(operation.autostash);
  }

  conflict(path: string): ConflictFile {
    const change = this.repository.status().find((entry) => entry.path === path && entry.conflict);
    if (!change?.conflict) throw new Error(`${path} has no conflicts.`);
    return { path, kind: change.conflict, text: this.repository.worktree.get(path) ?? null };
  }

  /** Resolves a conflicted file and stages the result. */
  resolve(path: string, resolution: ConflictResolution): void {
    const repository = this.repository;
    const stages = repository.conflicts.get(path) ?? {};
    switch (resolution.use) {
      case "ours":
      case "theirs":
        return repository.place(path, stages[resolution.use]);
      case "worktree":
        return repository.place(path, repository.worktree.get(path));
      case "delete":
        return repository.place(path, undefined);
      case "text":
        return repository.place(path, resolution.text);
    }
  }

  /**
   * Merges the changes from `base` to `theirs` into HEAD's files: merged
   * files are staged, conflicted ones get their stages and markers.
   * Refuses when that would overwrite local changes. Resolves to the paths
   * it changed.
   */
  apply(base: Tree, theirs: Tree, labels: MergeLabels, operation: string): string[] {
    const repository = this.repository;
    const head = repository.headTree();
    const { tree, conflicts } = mergeTrees(base, head, theirs, labels);
    const touched = [...new Set([...head.keys(), ...tree.keys(), ...conflicts.keys()])].filter(
      (path) => conflicts.has(path) || tree.get(path) !== head.get(path),
    );
    const local = touched.filter(
      (path) =>
        repository.conflicts.has(path) ||
        repository.index.get(path) !== head.get(path) ||
        repository.worktree.get(path) !== repository.index.get(path),
    );
    const untracked = local.filter((path) => !head.has(path) && !repository.index.has(path));
    repository.refuseOverwrite(
      local.filter((path) => !untracked.includes(path)),
      untracked,
      operation,
    );
    for (const path of touched) {
      const conflict = conflicts.get(path);
      if (!conflict) {
        repository.place(path, tree.get(path));
        continue;
      }
      repository.index.delete(path);
      repository.conflicts.set(path, conflict.stages);
      if (conflict.text === null) repository.worktree.delete(path);
      else repository.worktree.set(path, conflict.text);
    }
    return touched;
  }

  /** Staged changes would end up in the commit an operation makes; Git refuses to start with them. */
  private refuseStaged(operation: string): void {
    const repository = this.repository;
    if (!sameTree(repository.index, repository.headTree()) || repository.conflicts.size)
      throw new Error(`Commit or stash your staged changes before the ${operation}.`);
  }

  /** The paths an operation may have changed: those it recorded, or for a rebase, every file that differs from HEAD. */
  private touchedBy(operation: OperationState): string[] {
    if (operation.kind !== "rebase") return [...operation.touched];
    const repository = this.repository;
    const head = repository.headTree();
    return [...new Set([...head.keys(), ...repository.index.keys(), ...repository.conflicts.keys()])].filter(
      (path) =>
        repository.conflicts.has(path) ||
        repository.index.get(path) !== head.get(path) ||
        repository.worktree.get(path) !== repository.index.get(path),
    );
  }

  /** Gives `paths` HEAD's version again, in the index and the working tree. */
  private restore(paths: readonly string[]): void {
    const head = this.repository.headTree();
    for (const path of paths) this.repository.place(path, head.get(path));
  }

  private require(): OperationState {
    const operation = this.repository.operation;
    if (!operation) throw new Error("No merge, rebase, cherry-pick or revert is in progress.");
    return operation;
  }
}
