/**
 * The commits of an in-memory repository and the walks Git makes through
 * them: ancestry, merge bases, ranges and topological order. A commit holds
 * its whole tree, so any version of any file is one lookup away.
 */
import { sha256 } from "../../utilities/bytes";

/** Files by repository path. */
export type Tree = ReadonlyMap<string, string>;

export const EMPTY_TREE: Tree = new Map();

export interface Signature {
  readonly name: string;
  readonly email: string;
  /** ISO 8601 with the writer's UTC offset, as Git's `%aI`. */
  readonly date: string;
}

export interface CommitObject {
  /** 40 hexadecimal digits, like a SHA-1 commit ID. */
  readonly hash: string;
  readonly parents: readonly string[];
  readonly tree: Tree;
  readonly author: Signature;
  readonly committer: Signature;
  readonly message: string;
}

/** `date` as Git writes `%aI`: local time with its offset, to the second. */
export function isoDate(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const local = new Date(date.getTime() + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? "-" : "+";
  const minutes = Math.abs(offset);
  return `${local}${sign}${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The first line of a message. */
export const subjectOf = (message: string): string => message.trim().split("\n")[0]!;

export const sameTree = (a: Tree, b: Tree): boolean => a.size === b.size && [...a].every(([path, content]) => b.get(path) === content);

export class CommitStore {
  private readonly commits = new Map<string, CommitObject>();

  /** Stores a commit; the same content (parents, tree, people, dates, message) gives the same ID, as in Git. */
  add(commit: Omit<CommitObject, "hash">): CommitObject {
    const files = [...commit.tree].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, content]) => `${path}\0${sha256(content)}`);
    const hash = sha256(JSON.stringify([commit.parents, files, commit.author, commit.committer, commit.message])).slice(0, 40);
    const stored = { ...commit, hash };
    this.commits.set(hash, stored);
    return stored;
  }

  /** Stores a commit read from a real repository, under the ID Git gave it. */
  restore(commit: CommitObject): void {
    this.commits.set(commit.hash, commit);
  }

  get(hash: string): CommitObject {
    const commit = this.commits.get(hash);
    if (!commit) throw new Error(`Commit ${hash.slice(0, 7)} does not exist.`);
    return commit;
  }

  has(hash: string): boolean {
    return this.commits.has(hash);
  }

  /** The full ID of the commit that `prefix` (4 digits or more) names, if exactly one does. */
  expand(prefix: string): string | null {
    if (!/^[0-9a-f]{4,40}$/.test(prefix)) return null;
    const found = [...this.commits.keys()].filter((hash) => hash.startsWith(prefix));
    return found.length === 1 ? found[0]! : null;
  }

  /** `hash` and every commit it descends from. */
  ancestors(hash: string): Set<string> {
    const seen = new Set<string>();
    const stack = [hash];
    while (stack.length) {
      const next = stack.pop()!;
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...this.get(next).parents);
    }
    return seen;
  }

  /** Whether `ancestor` is `descendant` or one of its ancestors. */
  isAncestor(ancestor: string, descendant: string): boolean {
    return this.ancestors(descendant).has(ancestor);
  }

  /** The best common ancestor of two commits: one that no other common ancestor descends from. Null for unrelated histories. */
  mergeBase(a: string, b: string): string | null {
    const ofA = this.ancestors(a);
    const common = [...this.ancestors(b)].filter((hash) => ofA.has(hash));
    const best = common.filter((candidate) => !common.some((other) => other !== candidate && this.isAncestor(candidate, other)));
    // Several best ones (criss-cross merges) are rare; the newest stands in for Git's recursive base.
    return best.sort((x, y) => this.time(y) - this.time(x))[0] ?? null;
  }

  /** Commits `to` reaches and `from` does not (`from..to`), newest first in topological order. */
  range(from: string | null, to: string): CommitObject[] {
    const excluded = from ? this.ancestors(from) : new Set<string>();
    return this.topological([to]).filter((commit) => !excluded.has(commit.hash));
  }

  /**
   * The commits `tips` reach, children before their parents, as
   * `git log --topo-order` lists them: newest tips first, and each line of
   * history shown through before the next starts.
   */
  topological(tips: readonly string[]): CommitObject[] {
    const reachable = new Set<string>();
    for (const tip of tips) for (const hash of this.ancestors(tip)) reachable.add(hash);
    const children = new Map<string, number>();
    for (const hash of reachable) for (const parent of this.get(hash).parents) children.set(parent, (children.get(parent) ?? 0) + 1);
    // A stack: the parents of the commit just listed come next, the first parent last pushed, so first listed.
    const ready = [...reachable].filter((hash) => !children.get(hash)).sort((a, b) => this.time(a) - this.time(b));
    const listed: CommitObject[] = [];
    while (ready.length) {
      const commit = this.get(ready.pop()!);
      listed.push(commit);
      for (const parent of [...commit.parents].reverse()) {
        const left = children.get(parent)! - 1;
        children.set(parent, left);
        if (!left) ready.push(parent);
      }
    }
    return listed;
  }

  private time(hash: string): number {
    return Date.parse(this.get(hash).committer.date);
  }
}
