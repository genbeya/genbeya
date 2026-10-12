/**
 * A Git repository that lives in memory, for the web demo: commits with
 * their trees, the index and the working tree, branches, tags and
 * remote-tracking branches, and in {@link MemoryOperations},
 * {@link MemoryStashes} and {@link MemoryRemotes} merges, rebases, stashes
 * and a simulated remote. It follows Git's rules where the app can tell
 * the difference, and reports failures in words a user can act on.
 */
import type { Change, Commit, CommitFile, ConflictKind, Head, ResetMode } from "../../contracts/model";
import { within } from "../../utilities/repository-path";
import { CommitStore, EMPTY_TREE, isoDate, sameTree, subjectOf, type CommitObject, type Signature, type Tree } from "./commits";
import { IgnoreRules } from "./ignore-rules";
import { MemoryOperations, type OperationState } from "./memory-operations";
import { MemoryRemotes, type RemoteServer } from "./memory-remotes";
import { MemoryStashes, type StashEntry } from "./memory-stashes";
import { isValidBranchName, isValidRefName } from "./ref-names";
import { detectRenames } from "./renames";

/** A conflicted file's versions, as Git's index stages 1 (the common ancestor), 2 (ours) and 3 (theirs); a missing one was deleted or never there. */
export interface Stages {
  readonly base?: string;
  readonly ours?: string;
  readonly theirs?: string;
}

export type HeadState = { readonly branch: string } | { readonly detached: string };

export interface Identity {
  readonly name: string;
  readonly email: string;
}

export interface MemoryRepositoryOptions {
  /** Who commits: Git's `user.name` and `user.email`. */
  readonly identity: Identity;
  /** The clock commits are dated by. */
  readonly now?: () => Date;
}

/** A commit that changed a file, with the file before and after it. */
export interface FileRevision {
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
  readonly path: string;
  /** The path before the commit; null when the commit added the file. */
  readonly oldPath: string | null;
  readonly before: string | null;
  readonly after: string;
}

/** The status letters of a conflicted file by which stages it has, as `git status` prints them. */
const CONFLICT_LETTERS: Readonly<Record<string, [string, ConflictKind]>> = {
  "111": ["UU", "both-modified"],
  "011": ["AA", "both-added"],
  "100": ["DD", "both-deleted"],
  "010": ["AU", "added-by-us"],
  "001": ["UA", "added-by-them"],
  "101": ["DU", "deleted-by-us"],
  "110": ["UD", "deleted-by-them"],
};

const short = (hash: string) => hash.slice(0, 7);

/** The list of `paths` for a message: "a", "a and b", "a, b and 2 more". */
function listPaths(paths: readonly string[]): string {
  if (paths.length <= 2) return paths.join(" and ");
  return paths.length === 3 ? `${paths[0]}, ${paths[1]} and ${paths[2]}` : `${paths[0]}, ${paths[1]} and ${paths.length - 2} more`;
}

const byPath = (a: { path: string }, b: { path: string }) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export class MemoryRepository {
  readonly commits = new CommitStore();
  /** The working tree: file contents by path. */
  readonly worktree = new Map<string, string>();
  /** The index: staged contents by path, conflicted files aside. */
  readonly index = new Map<string, string>();
  readonly conflicts = new Map<string, Stages>();
  head: HeadState = { branch: "main" };
  readonly branches = new Map<string, string>();
  /** Tags by name; annotated ones have a message. */
  readonly tags = new Map<string, { readonly commit: string; readonly message: string }>();
  /** Remote-tracking branches by short name, such as `origin/main`, as the last fetch saw them. */
  readonly tracking = new Map<string, string>();
  /** The branch each remote's HEAD names, as the last fetch saw it. */
  readonly remoteHeads = new Map<string, string>();
  readonly upstreams = new Map<string, { readonly remote: string; readonly branch: string }>();
  /** The repositories behind the remotes, simulated in memory too. */
  readonly remotes = new Map<string, RemoteServer>();
  /** Newest first. */
  stashList: StashEntry[] = [];
  operation: OperationState | null = null;

  readonly identity: Identity;
  readonly now: () => Date;
  readonly operations = new MemoryOperations(this);
  readonly stashes = new MemoryStashes(this);
  readonly sync = new MemoryRemotes(this);

  constructor({ identity, now = () => new Date() }: MemoryRepositoryOptions) {
    this.identity = identity;
    this.now = now;
  }

  // Commits and names.

  signature(who: Identity = this.identity, date = this.now()): Signature {
    return { name: who.name, email: who.email, date: isoDate(date) };
  }

  headCommit(): string | null {
    return "detached" in this.head ? this.head.detached : (this.branches.get(this.head.branch) ?? null);
  }

  currentBranch(): string | null {
    return "branch" in this.head ? this.head.branch : null;
  }

  treeOf(hash: string | null): Tree {
    return hash ? this.commits.get(hash).tree : EMPTY_TREE;
  }

  headTree(): Tree {
    return this.treeOf(this.headCommit());
  }

  /** Moves the current branch (or the detached HEAD) to `hash`; files stay as they are. */
  setHead(hash: string): void {
    if ("branch" in this.head) this.branches.set(this.head.branch, hash);
    else this.head = { detached: hash };
  }

  /** A commit made now by the user, unless `author` and `committer` say otherwise. */
  writeCommit(tree: Tree, parents: readonly string[], message: string, author?: Signature, committer = this.signature()): CommitObject {
    return this.commits.add({ tree: new Map(tree), parents, message, author: author ?? committer, committer });
  }

  /** The commit a branch, remote-tracking branch, tag, HEAD or (abbreviated) commit ID names. */
  resolve(revision: string): string {
    const hash =
      (revision === "HEAD" ? this.headCommit() : null) ??
      this.branches.get(revision) ??
      this.tracking.get(revision) ??
      this.tags.get(revision)?.commit ??
      (this.commits.has(revision) ? revision : this.commits.expand(revision));
    if (!hash) throw new Error(`${revision} is not a branch, tag or commit.`);
    return hash;
  }

  isValidBranchName(name: string): boolean {
    return isValidBranchName(name);
  }

  isValidTagName(name: string): boolean {
    return isValidRefName(name);
  }

  // The working tree and the index.

  /** The .gitignore rules of the working tree. */
  ignoreRules(): IgnoreRules {
    return new IgnoreRules(this.worktree);
  }

  /** Files that are not tracked and not ignored. */
  untracked(rules = this.ignoreRules()): string[] {
    return [...this.worktree.keys()].filter((path) => !this.index.has(path) && !this.conflicts.has(path) && !rules.ignores(path)).sort();
  }

  /** Tracked and untracked files that exist and are not ignored, as `git ls-files` lists the tree. */
  files(): string[] {
    const tracked = [...this.index.keys(), ...this.conflicts.keys()].filter((path) => this.worktree.has(path));
    return [...new Set([...tracked, ...this.untracked()])].sort();
  }

  /** Whether `path` is a file or a folder of the working tree. */
  kind(path: string): "file" | "dir" | null {
    if (this.worktree.has(path)) return "file";
    for (const file of this.worktree.keys()) if (within(file, path)) return "dir";
    return null;
  }

  /** The index as a tree for a commit; conflicts must be resolved first. */
  indexTree(): Tree {
    if (this.conflicts.size) throw new Error("Resolve the conflicted files first.");
    return new Map(this.index);
  }

  /** Whether tracked files differ from HEAD, in the index or the working tree. */
  hasChanges(): boolean {
    return this.status().some((change) => change.index !== "?");
  }

  /** `git status`: conflicts, staged and unstaged changes, untracked files; staged renames are found. */
  status(): Change[] {
    const head = this.headTree();
    const rules = this.ignoreRules();
    const changes: Change[] = [];
    const paths = new Set([...head.keys(), ...this.index.keys(), ...this.conflicts.keys()]);
    for (const path of paths) {
      const stages = this.conflicts.get(path);
      if (stages) {
        const [letters, kind] = CONFLICT_LETTERS[["base", "ours", "theirs"].map((stage) => Number(stage in stages)).join("")]!;
        changes.push({ path, index: letters[0]!, worktree: letters[1]!, conflict: kind });
        continue;
      }
      const committed = head.get(path);
      const staged = this.index.get(path);
      const current = this.worktree.get(path);
      const index =
        committed === undefined ? (staged === undefined ? " " : "A") : staged === undefined ? "D" : staged === committed ? " " : "M";
      const worktree = staged === undefined ? " " : current === undefined ? "D" : current === staged ? " " : "M";
      if (index !== " " || worktree !== " ") changes.push({ path, index, worktree });
    }
    for (const path of this.untracked(rules)) changes.push({ path, index: "?", worktree: "?" });
    return this.withRenames(changes, head).sort(byPath);
  }

  /** Staged deletions and additions that are renames become one change each. */
  private withRenames(changes: Change[], head: Tree): Change[] {
    const deleted = new Map(changes.filter((change) => change.index === "D").map((change) => [change.path, head.get(change.path)!]));
    const added = new Map(changes.filter((change) => change.index === "A").map((change) => [change.path, this.index.get(change.path)!]));
    const renames = detectRenames(deleted, added);
    if (!renames.length) return changes;
    const from = new Map(renames.map((rename) => [rename.to, rename.from]));
    const gone = new Set(renames.map((rename) => rename.from));
    return changes
      .filter((change) => !(change.index === "D" && gone.has(change.path)))
      .map((change) =>
        change.index === "A" && from.has(change.path) ? { ...change, oldPath: from.get(change.path)!, index: "R" } : change,
      );
  }

  /** The current branch, its commit and how it compares with its upstream. */
  headState(): Head {
    const commit = this.headCommit();
    const branch = this.currentBranch();
    const upstream = branch ? this.upstreams.get(branch) : undefined;
    const name = upstream ? `${upstream.remote}/${upstream.branch}` : null;
    const tip = name ? this.tracking.get(name) : undefined;
    return {
      branch,
      commit: commit && short(commit),
      upstream: name,
      ahead: commit && tip ? this.commits.range(tip, commit).length : 0,
      behind: commit && tip ? this.commits.range(commit, tip).length : 0,
    };
  }

  /** The paths `pathspecs` name: files, or everything below folders, in the working tree, the index or HEAD. */
  private expand(pathspecs: readonly string[]): string[] {
    const known = new Set([...this.worktree.keys(), ...this.index.keys(), ...this.conflicts.keys(), ...this.headTree().keys()]);
    const found = [...known].filter((path) => pathspecs.some((spec) => path === spec || within(path, spec)));
    const missing = pathspecs.filter((spec) => !found.some((path) => path === spec || within(path, spec)));
    if (missing.length) throw new Error(`${listPaths(missing)} did not match any files.`);
    return found.sort();
  }

  /** `git add -A`: the index takes the working tree's version, or loses files gone from it; conflicts count as resolved. */
  add(pathspecs: readonly string[]): void {
    const rules = this.ignoreRules();
    const paths = this.expand(pathspecs);
    const ignored = pathspecs.filter((spec) => this.worktree.has(spec) && !this.index.has(spec) && rules.ignores(spec));
    if (ignored.length) throw new Error(`${listPaths(ignored)} is ignored by a .gitignore file.`);
    for (const path of paths) {
      const content = this.worktree.get(path);
      if (content === undefined) {
        if (!this.index.has(path) && !this.conflicts.has(path)) continue;
        this.index.delete(path);
      } else {
        if (!this.index.has(path) && !this.conflicts.has(path) && rules.ignores(path)) continue;
        this.index.set(path, content);
      }
      this.conflicts.delete(path);
    }
  }

  /** Sets the index entries of `paths` to their version in `tree`, removing those it lacks (`git reset <tree> -- paths`). */
  restoreStaged(paths: readonly string[], tree: Tree = this.headTree()): void {
    for (const path of paths) {
      const content = tree.get(path);
      if (content === undefined) this.index.delete(path);
      else this.index.set(path, content);
      this.conflicts.delete(path);
    }
  }

  /** Reverts working-tree edits of tracked files to the staged version. */
  restoreWorktree(paths: readonly string[]): void {
    for (const path of paths) {
      const staged = this.index.get(path);
      if (staged === undefined) continue;
      this.worktree.set(path, staged);
    }
  }

  /**
   * Removes paths (files, or folders with what they hold) from the index and
   * keeps the files; without `force`, refused for staged content found
   * neither in the file nor in HEAD.
   */
  untrack(pathspecs: readonly string[], force = false): void {
    const head = this.headTree();
    const paths = this.expand(pathspecs).filter((path) => this.index.has(path) || this.conflicts.has(path));
    const lost = paths.filter((path) => {
      const staged = this.index.get(path);
      return staged !== undefined && staged !== this.worktree.get(path) && staged !== head.get(path);
    });
    if (lost.length && !force)
      throw new Error(
        `${listPaths(lost)} ${lost.length === 1 ? "has" : "have"} staged changes that are neither in the file nor in the last commit, which Stop tracking would lose. Commit or unstage them first.`,
      );
    for (const path of paths) {
      this.index.delete(path);
      this.conflicts.delete(path);
    }
  }

  /** Writes a file of the working tree. */
  write(path: string, content: string): void {
    this.worktree.set(path, content);
  }

  /** Deletes a file of the working tree. */
  remove(path: string): void {
    this.worktree.delete(path);
  }

  // Committing and history.

  /**
   * Commits the index; `amend` replaces the last commit, keeping its author.
   * A merge in progress is concluded. `as` commits as someone else than
   * the user, as the sample's commits are made.
   */
  commit(message: string, amend: boolean, as?: Identity): CommitObject {
    const by = as && this.signature(as);
    const tree = this.indexTree();
    const head = this.headCommit();
    if (amend) {
      if (!head) throw new Error("There is no commit to amend yet.");
      const previous = this.commits.get(head);
      const commit = this.writeCommit(tree, previous.parents, message, previous.author, by);
      this.setHead(commit.hash);
      return commit;
    }
    const merging = this.operation?.kind === "merge" ? this.operation.theirs : null;
    if (!merging && sameTree(tree, this.headTree())) throw new Error("Nothing to commit. Stage your changes first.");
    const commit = this.writeCommit(tree, [...(head ? [head] : []), ...(merging ? [merging] : [])], message, by, by);
    this.setHead(commit.hash);
    // Committing concludes a merge, pick or revert whose conflicts are resolved, as in Git.
    if (this.operation && this.operation.kind !== "rebase") this.operation = null;
    return commit;
  }

  /** Every branch, remote-tracking branch, tag and HEAD, with their names as `git log --decorate` shows them. */
  decorations(): Map<string, string[]> {
    const names = new Map<string, string[]>();
    const add = (hash: string | null | undefined, name: string) => {
      if (hash) names.set(hash, [...(names.get(hash) ?? []), name]);
    };
    const current = this.currentBranch();
    if (current) add(this.branches.get(current), `HEAD -> ${current}`);
    else add(this.headCommit(), "HEAD");
    for (const [name, hash] of [...this.branches].sort()) if (name !== current) add(hash, name);
    for (const [name, hash] of [...this.tracking].sort()) add(hash, name);
    for (const [remote, branch] of this.remoteHeads)
      if (this.tracking.has(`${remote}/${branch}`)) add(this.tracking.get(`${remote}/${branch}`), `${remote}/HEAD`);
    for (const [name, tag] of [...this.tags].sort()) add(tag.commit, `tag: ${name}`);
    return names;
  }

  /** The commit as the client shows it. */
  describe(commit: CommitObject, decorations = this.decorations()): Commit {
    return {
      hash: commit.hash,
      parents: commit.parents,
      author: commit.author.name,
      email: commit.author.email,
      date: commit.author.date,
      subject: subjectOf(commit.message),
      refs: decorations.get(commit.hash) ?? [],
    };
  }

  /** `git log --all --topo-order`: every commit the branches, tags and HEAD reach, stashes aside. */
  log(skip: number, limit: number): Commit[] {
    const tips = [
      this.headCommit(),
      ...this.branches.values(),
      ...this.tracking.values(),
      ...[...this.tags.values()].map((tag) => tag.commit),
    ];
    const decorations = this.decorations();
    return this.commits
      .topological([...new Set(tips.filter((tip): tip is string => !!tip))])
      .slice(skip, skip + limit)
      .map((commit) => this.describe(commit, decorations));
  }

  /** How `to` differs from `from`, file by file, with renames. */
  changedFiles(from: Tree, to: Tree): CommitFile[] {
    const files: CommitFile[] = [];
    const deleted = new Map<string, string>();
    const added = new Map<string, string>();
    for (const path of new Set([...from.keys(), ...to.keys()])) {
      const before = from.get(path);
      const after = to.get(path);
      if (before === after) continue;
      if (before === undefined) added.set(path, after!);
      else if (after === undefined) deleted.set(path, before);
      else files.push({ path, status: "M" });
    }
    const renames = detectRenames(deleted, added);
    for (const { from: oldPath, to: path } of renames) {
      deleted.delete(oldPath);
      added.delete(path);
      files.push({ path, oldPath, status: "R" });
    }
    for (const path of added.keys()) files.push({ path, status: "A" });
    for (const path of deleted.keys()) files.push({ path, status: "D" });
    return files.sort(byPath);
  }

  /** The files a commit changed, compared with its first parent (`git diff-tree -M`). */
  commitFiles(hash: string): CommitFile[] {
    const commit = this.commits.get(hash);
    return this.changedFiles(this.treeOf(commit.parents[0] ?? null), commit.tree);
  }

  /**
   * The commits that changed `path`, newest first, following renames
   * (`git log --follow --no-merges`), with the file before and after each.
   * The history ends with the commit that added the file.
   */
  fileHistory(path: string, limit: number): FileRevision[] {
    const head = this.headCommit();
    if (!head) return [];
    const revisions: FileRevision[] = [];
    let current = path;
    for (const commit of this.commits.topological([head])) {
      if (revisions.length >= limit) break;
      if (commit.parents.length > 1) continue;
      const after = commit.tree.get(current);
      if (after === undefined) continue;
      const parent = this.treeOf(commit.parents[0] ?? null);
      const before = parent.get(current);
      if (before === after) continue;
      const base = {
        hash: commit.hash,
        author: commit.author.name,
        date: commit.author.date,
        subject: subjectOf(commit.message),
        path: current,
      };
      if (before !== undefined) {
        revisions.push({ ...base, oldPath: current, before, after });
        continue;
      }
      const deleted = new Map([...parent].filter(([file]) => !commit.tree.has(file)));
      const rename = detectRenames(deleted, new Map([[current, after]]))[0];
      if (!rename) {
        revisions.push({ ...base, oldPath: null, before: null, after });
        break;
      }
      revisions.push({ ...base, oldPath: rename.from, before: parent.get(rename.from)!, after });
      current = rename.from;
    }
    return revisions;
  }

  /** The authors of the newest `limit` commits of HEAD, with how many each wrote. */
  authors(limit: number): { name: string; email: string; commits: number }[] {
    const head = this.headCommit();
    if (!head) return [];
    const counts = new Map<string, { name: string; email: string; commits: number }>();
    for (const commit of this.commits.topological([head]).slice(0, limit)) {
      const { name, email } = commit.author;
      const key = `${name}\0${email}`;
      counts.set(key, { name, email, commits: (counts.get(key)?.commits ?? 0) + 1 });
    }
    return [...counts.values()];
  }

  // Branches and tags.

  createBranch(name: string, start: string): void {
    if (this.branches.has(name)) throw new Error(`A branch named ${name} already exists.`);
    this.branches.set(name, start);
  }

  renameBranch(name: string, newName: string): void {
    if (this.branches.has(newName)) throw new Error(`A branch named ${newName} already exists.`);
    this.branches.set(newName, this.branches.get(name)!);
    this.branches.delete(name);
    const upstream = this.upstreams.get(name);
    this.upstreams.delete(name);
    if (upstream) this.upstreams.set(newName, upstream);
    if (this.currentBranch() === name) this.head = { branch: newName };
  }

  /** False when the branch has commits that neither its upstream nor HEAD has, and `force` is false. */
  deleteBranch(name: string, force: boolean): boolean {
    if (this.currentBranch() === name) throw new Error(`${name} is checked out. Switch to another branch first.`);
    const tip = this.branches.get(name)!;
    const upstream = this.upstreams.get(name);
    const merged = this.tracking.get(upstream ? `${upstream.remote}/${upstream.branch}` : "") ?? this.headCommit();
    if (!force && (!merged || !this.commits.isAncestor(tip, merged))) return false;
    this.branches.delete(name);
    this.upstreams.delete(name);
    return true;
  }

  createTag(name: string, commit: string, message: string): void {
    if (this.tags.has(name)) throw new Error(`A tag named ${name} already exists.`);
    this.tags.set(name, { commit, message });
  }

  // Moving HEAD.

  /**
   * Updates the index and the working tree from HEAD's tree to `target`, as
   * a checkout does: local changes to files that stay the same come along;
   * those to files that change, and untracked files in the way, stop it.
   */
  checkout(target: Tree, operation: string): void {
    const { changed, local, untracked } = this.blockers(target);
    this.refuseOverwrite(local, untracked, operation);
    for (const path of changed) this.place(path, target.get(path));
  }

  /** The files that differ between HEAD's tree and `target`, and those of them with local changes or untracked in the way. */
  private blockers(target: Tree): { changed: string[]; local: string[]; untracked: string[] } {
    const head = this.headTree();
    const changed = [...new Set([...head.keys(), ...target.keys()])].filter((path) => head.get(path) !== target.get(path));
    const local: string[] = [];
    const untracked: string[] = [];
    for (const path of changed) {
      const wanted = target.get(path);
      if (this.conflicts.has(path)) local.push(path);
      else if (head.has(path) || this.index.has(path)) {
        const dirty = this.index.get(path) !== head.get(path) || this.worktree.get(path) !== this.index.get(path);
        // A local version that is the target's already is no loss.
        if (dirty && !(this.index.get(path) === wanted && this.worktree.get(path) === wanted)) local.push(path);
      } else if (this.worktree.has(path) && this.worktree.get(path) !== wanted) untracked.push(path);
    }
    return { changed, local, untracked };
  }

  /** Refuses an operation that would overwrite local changes or untracked files. */
  refuseOverwrite(local: readonly string[], untracked: readonly string[], operation: string): void {
    if (local.length)
      throw new Error(`Your local changes to ${listPaths(local)} would be overwritten by ${operation}. Commit or stash them first.`);
    if (untracked.length)
      throw new Error(
        `The untracked ${untracked.length === 1 ? "file" : "files"} ${listPaths(untracked)} would be overwritten by ${operation}. Move or remove ${untracked.length === 1 ? "it" : "them"} first.`,
      );
  }

  /** Sets a file in the index and the working tree; undefined deletes it from both. */
  place(path: string, content: string | undefined): void {
    this.conflicts.delete(path);
    if (content === undefined) {
      this.index.delete(path);
      this.worktree.delete(path);
    } else {
      this.index.set(path, content);
      this.worktree.set(path, content);
    }
  }

  /** Switches to a local branch, or detaches HEAD at a commit. */
  switchTo(target: HeadState): void {
    const hash = "branch" in target ? this.branches.get(target.branch) : target.detached;
    if (!hash) throw new Error(`There is no branch ${"branch" in target ? target.branch : ""}.`);
    this.checkout(this.treeOf(hash), "switching");
    this.head = target;
  }

  /**
   * Moves the current branch to `target`. Soft keeps the index and the
   * working tree; mixed resets the index; hard resets both; keep changes the
   * files that differ between the commits, refusing where that would
   * overwrite local changes.
   */
  reset(target: string, mode: ResetMode): void {
    const to = this.treeOf(target);
    if (mode === "keep") {
      const { local, untracked } = this.blockers(to);
      if (local.length)
        throw new Error(
          `Keep would overwrite your uncommitted changes to ${listPaths(local)}. Commit or stash them, or choose another mode.`,
        );
      if (untracked.length)
        throw new Error(`Keep would overwrite the untracked file ${listPaths(untracked)}. Move it away, or choose another mode.`);
      this.checkout(to, "the reset");
    }
    if (mode === "mixed" || mode === "hard") {
      const tracked = new Set([...this.index.keys(), ...this.conflicts.keys(), ...this.headTree().keys()]);
      this.index.clear();
      this.conflicts.clear();
      for (const [path, content] of to) this.index.set(path, content);
      if (mode === "hard") {
        for (const path of tracked) if (!to.has(path)) this.worktree.delete(path);
        for (const [path, content] of to) this.worktree.set(path, content);
      }
    }
    this.setHead(target);
  }

  /** Untracked (or ignored) files `target` has and HEAD has not, which hard and keep resets overwrite. */
  overwrittenBy(target: string): string[] {
    const head = this.headTree();
    return [...this.treeOf(target).keys()].filter((path) => !head.has(path) && this.worktree.has(path) && !this.index.has(path)).sort();
  }
}
