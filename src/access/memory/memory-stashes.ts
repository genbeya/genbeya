/**
 * The stash of the in-memory repository, made as Git makes it: a commit of
 * the working tree whose parents are HEAD, a commit of the index and, when
 * asked, a commit of the untracked files. Applying merges its changes into
 * the working tree, with conflict markers where they collide.
 */
import type { OperationOutcome, Stash, StashDetail } from "../../contracts/model";
import { EMPTY_TREE, subjectOf } from "./commits";
import { mergeTrees } from "./memory-operations";
import type { MemoryRepository } from "./memory-repository";

export interface StashEntry {
  /** The stash's commit. */
  readonly commit: string;
  /** As the reflog has it: "On main: message", or "WIP on main: 1234567 subject". */
  readonly subject: string;
  readonly date: string;
}

const LABELS = { ours: "Updated upstream", theirs: "Stashed changes" };

export class MemoryStashes {
  constructor(private readonly repository: MemoryRepository) {}

  /** Newest first. */
  list(): Stash[] {
    return this.repository.stashList.map((entry, index) => {
      const match = /^(?:WIP on|On) ([^:]+): ([\s\S]*)$/.exec(entry.subject);
      const branch = match && match[1] !== "(no branch)" ? match[1]! : null;
      return { hash: entry.commit, index, date: entry.date, branch, message: match ? match[2]! : entry.subject };
    });
  }

  find(hash: string): StashEntry {
    const entry = this.repository.stashList.find((stash) => stash.commit === hash);
    if (!entry) throw new Error("This stash no longer exists.");
    return entry;
  }

  /** Stashes the uncommitted changes and adds the stash to the list. */
  push(message: string, options: { includeUntracked: boolean; keepIndex: boolean }): void {
    this.repository.stashList.unshift(this.save(message, options));
  }

  /**
   * Records the uncommitted changes in a stash commit and takes them out of
   * the working tree (and the index, unless `keepIndex`); the stash is not
   * listed, which {@link push} does.
   */
  save(message: string, { includeUntracked, keepIndex }: { includeUntracked: boolean; keepIndex: boolean }): StashEntry {
    const repository = this.repository;
    const head = repository.headCommit();
    if (!head) throw new Error("There is no commit to stash onto yet.");
    const headTree = repository.headTree();
    const branch = repository.currentBranch() ?? "(no branch)";
    const description = `${branch}: ${head.slice(0, 7)} ${subjectOf(repository.commits.get(head).message)}`;
    const index = repository.writeCommit(repository.indexTree(), [head], `index on ${description}`);
    const untrackedFiles = includeUntracked ? repository.untracked() : [];
    const untracked = untrackedFiles.length
      ? repository.writeCommit(
          new Map(untrackedFiles.map((path) => [path, repository.worktree.get(path)!])),
          [],
          `untracked files on ${description}`,
        )
      : null;
    const tree = new Map(
      [...repository.index.keys()].flatMap((path) =>
        repository.worktree.has(path) ? [[path, repository.worktree.get(path)!] as const] : [],
      ),
    );
    const subject = message ? `On ${branch}: ${message}` : `WIP on ${description}`;
    const stash = repository.writeCommit(tree, [head, index.hash, ...(untracked ? [untracked.hash] : [])], subject);
    if (keepIndex) for (const [path, content] of repository.index) repository.worktree.set(path, content);
    else for (const path of new Set([...headTree.keys(), ...repository.index.keys()])) repository.place(path, headTree.get(path));
    for (const path of untrackedFiles) repository.worktree.delete(path);
    return { commit: stash.hash, subject, date: stash.committer.date };
  }

  /** The files a stash changed, compared with the commit it was made on, then the untracked files it holds. */
  detail(hash: string): StashDetail {
    const repository = this.repository;
    const stash = this.list().find((entry) => entry.hash === hash);
    if (!stash) throw new Error("This stash no longer exists.");
    const commit = repository.commits.get(hash);
    const untracked = commit.parents[2];
    return {
      stash,
      files: [
        ...repository.changedFiles(repository.treeOf(commit.parents[0]!), commit.tree).map((file) => ({ ...file, commit: hash })),
        ...(untracked
          ? repository.changedFiles(EMPTY_TREE, repository.treeOf(untracked)).map((file) => ({ ...file, commit: untracked }))
          : []),
      ],
    };
  }

  /** Applies a stash to the working tree; `pop` also drops it, unless applying it conflicts. */
  apply(hash: string, pop: boolean): OperationOutcome {
    const entry = this.find(hash);
    this.applyEntry(entry);
    if (this.repository.conflicts.size) return "stopped";
    if (pop) this.drop(hash);
    return "done";
  }

  /**
   * Brings back changes set aside during an operation: applied when they
   * merge cleanly, else kept in the stash list for the user, as Git does
   * with an autostash.
   */
  restore(entry: StashEntry): void {
    const repository = this.repository;
    const commit = repository.commits.get(entry.commit);
    const { conflicts } = mergeTrees(repository.treeOf(commit.parents[0]!), repository.headTree(), commit.tree, LABELS);
    if (conflicts.size) {
      repository.stashList.unshift(entry);
      return;
    }
    try {
      this.applyEntry(entry);
    } catch {
      repository.stashList.unshift(entry);
    }
  }

  drop(hash: string): void {
    const entry = this.find(hash);
    this.repository.stashList = this.repository.stashList.filter((stash) => stash !== entry);
  }

  /** Creates a branch at the stash's base commit, switches to it, applies the stash there and drops it. */
  branch(hash: string, name: string): void {
    const repository = this.repository;
    const entry = this.find(hash);
    const base = repository.commits.get(hash).parents[0]!;
    if (repository.branches.has(name)) throw new Error(`A branch named ${name} already exists.`);
    repository.checkout(repository.treeOf(base), "switching");
    repository.branches.set(name, base);
    repository.head = { branch: name };
    this.applyEntry(entry);
    if (!repository.conflicts.size) this.drop(hash);
  }

  /** Merges the stash's changes into the working tree; files it adds are staged, as `git stash apply` does. */
  private applyEntry(entry: StashEntry): void {
    const repository = this.repository;
    const commit = repository.commits.get(entry.commit);
    const untracked = repository.treeOf(commit.parents[2] ?? null);
    const inTheWay = [...untracked.keys()].filter((path) => repository.worktree.has(path));
    if (inTheWay.length) throw new Error(`${inTheWay.join(", ")} already exists; move it away to apply this stash.`);
    const head = repository.headTree();
    const touched = repository.operations.apply(repository.treeOf(commit.parents[0]!), commit.tree, LABELS, "applying the stash");
    // Changes come back unstaged; new files stay staged.
    for (const path of touched) if (!repository.conflicts.has(path) && head.has(path)) repository.restoreStaged([path], head);
    for (const [path, content] of untracked) repository.worktree.set(path, content);
  }
}
