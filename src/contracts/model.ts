/** Data exchanged between the client and the managers. Plain, serialisable values only. */

export type Location =
  | { readonly kind: "local"; readonly path: string }
  | { readonly kind: "wsl"; readonly distro: string; readonly path: string }
  | { readonly kind: "ssh"; readonly host: string; readonly path: string };

/** A location on a WSL distribution or an SSH server. */
export type RemoteLocation = Exclude<Location, { readonly kind: "local" }>;

export interface Folder {
  readonly name: string;
  /** Holds a `.git` entry. */
  readonly repository: boolean;
}

/** The subfolders of a folder on a remote machine, for choosing a path there. */
export interface FolderListing {
  /** Absolute, with symbolic links resolved. */
  readonly path: string;
  /** Null at the root. */
  readonly parent: string | null;
  /** By name, ignoring case; hidden folders (".name") last. */
  readonly folders: readonly Folder[];
  /** True when the folder holds more subfolders than are listed. */
  readonly truncated: boolean;
}

export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Project settings, stored in `.gitdesk.yml` next to the wiki and tasks. */
export interface Settings {
  readonly name: string;
  readonly wikiRoot: string;
  readonly wikiHome: string;
  readonly taskRoot: string;
  readonly taskPrefix: string;
  readonly statuses: readonly string[];
  /** Workflow states the board leaves out (the list still shows them). */
  readonly hiddenColumns: readonly string[];
}

export interface FileNode {
  readonly name: string;
  readonly path: string;
  readonly children?: readonly FileNode[];
}

export interface WikiNode {
  readonly title: string;
  /** The page file, or null for a folder without a matching page. */
  readonly path: string | null;
  /** The folder holding subpages, if any. */
  readonly folder: string | null;
  readonly children: readonly WikiNode[];
}

export interface Task {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly assignee: string;
  readonly labels: readonly string[];
  readonly body: string;
  /** The folder below the task folder that holds the task ("Auth/Tokens"); "" for none. */
  readonly epic: string;
  /** Version of the file the task was read from; updates must name it. */
  readonly hash: string;
}

export type TaskInput = Pick<Task, "title" | "status" | "priority" | "assignee" | "labels" | "body" | "epic">;

export interface Change {
  readonly path: string;
  readonly oldPath?: string;
  /** Porcelain status letter of the index (" " when unchanged, "?" when untracked). */
  readonly index: string;
  /** Porcelain status letter of the working tree (" " when unchanged, "?" when untracked). */
  readonly worktree: string;
  /** Set while the file has unresolved conflicts. */
  readonly conflict?: ConflictKind;
}

/** How the sides of a conflicted file differ. "Us" is HEAD; "them" is what comes in (during a rebase, the commit being replayed). */
export type ConflictKind =
  "both-modified" | "both-added" | "both-deleted" | "added-by-us" | "added-by-them" | "deleted-by-us" | "deleted-by-them";

/** A conflicted file, for resolving it. */
export interface ConflictFile {
  readonly path: string;
  readonly kind: ConflictKind;
  /** The working-tree file with its conflict markers; null when it is binary, too large or missing. */
  readonly text: string | null;
}

/**
 * How to resolve a conflicted file: one side as a whole ("ours" is HEAD), the
 * working-tree file as it is, deleting the file, or new text. Each stages the result.
 */
export type ConflictResolution =
  { readonly use: "ours" | "theirs" | "worktree" | "delete" } | { readonly use: "text"; readonly text: string };

export type OperationKind = "merge" | "rebase" | "cherry-pick" | "revert";

/** A merge, rebase, cherry-pick or revert that stopped, usually for conflicts, until it is continued or aborted. */
export interface Operation {
  readonly kind: OperationKind;
  /** What comes in: the merged branch, the rebased branch, or the subject of the picked or reverted commit. */
  readonly source: string;
  /** Where it goes: the current branch, or what a rebase goes onto; null when unknown. */
  readonly target: string | null;
  /** A rebase's progress: the step being applied, counted from 1, of `steps`. */
  readonly step: number | null;
  readonly steps: number | null;
}

/** How an operation that can conflict ended: "stopped" leaves it in progress, see {@link Snapshot.operation}. */
export type OperationOutcome = "done" | "stopped";

export interface Stash {
  readonly hash: string;
  /** The position in the stash list: stash@{index}. */
  readonly index: number;
  readonly message: string;
  /** The branch it was made on; null on a detached HEAD. */
  readonly branch: string | null;
  readonly date: string;
}

export interface StashOptions {
  readonly message: string;
  readonly includeUntracked: boolean;
  /** Leaves staged changes in place, stashing them too. */
  readonly keepIndex: boolean;
}

/** A stashed file; its diff is that of `commit` (the stash, or the stash's commit of untracked files). */
export interface StashFile extends CommitFile {
  readonly commit: string;
}

export interface StashDetail {
  readonly stash: Stash;
  readonly files: readonly StashFile[];
}

export interface MergeOptions {
  /** Creates a merge commit even when the branch could fast-forward. */
  readonly noFastForward: boolean;
  /** The merge commit's message; empty for Git's default. */
  readonly message: string;
}

export interface RebaseCommit {
  readonly hash: string;
  readonly subject: string;
  /** The full message. */
  readonly message: string;
  readonly author: string;
  readonly date: string;
  readonly merge: boolean;
}

/** The commits a rebase would rewrite, oldest first, and the remote branches that already have some of them. */
export interface RebasePlan {
  readonly base: string;
  readonly commits: readonly RebaseCommit[];
  readonly pushed: readonly string[];
}

export const REBASE_ACTIONS = ["pick", "reword", "squash", "fixup", "drop"] as const;
export type RebaseAction = (typeof REBASE_ACTIONS)[number];

/**
 * One commit of an interactive rebase, in the new order. `message` replaces
 * the message of the commit it produces (reword) or joins (squash).
 */
export interface RebaseStep {
  readonly hash: string;
  readonly action: RebaseAction;
  readonly message?: string;
}

export interface Remote {
  readonly name: string;
  readonly url: string;
}

export interface Head {
  readonly branch: string | null;
  /** Short commit id, null on an unborn branch. */
  readonly commit: string | null;
  readonly upstream: string | null;
  readonly ahead: number;
  readonly behind: number;
}

export type Storage =
  | { readonly mode: "worktree" }
  | {
      readonly mode: "branch";
      readonly branch: string;
      readonly remote: string | null;
      readonly ahead: number;
      readonly behind: number;
    };

export type StorageMode = Storage["mode"];

/** Everything the client shows about an open repository, polled with {@link Snapshot.version}. */
export interface Snapshot {
  readonly version: string;
  readonly location: Location;
  readonly settings: Settings;
  /** Version of `.gitdesk.yml`, null while it does not exist. */
  readonly settingsHash: string | null;
  readonly storage: Storage;
  readonly head: Head;
  readonly branches: readonly string[];
  /** Remote-tracking branches without a local counterpart, such as `origin/feature`. */
  readonly remoteBranches: readonly string[];
  readonly remotes: readonly Remote[];
  readonly changes: readonly Change[];
  readonly tags: readonly string[];
  /** Newest first. */
  readonly stashes: readonly Stash[];
  /** The merge, rebase, cherry-pick or revert in progress, if any. */
  readonly operation: Operation | null;
  readonly files: readonly FileNode[];
  readonly wiki: readonly WikiNode[];
  readonly tasks: readonly Task[];
  readonly warnings: readonly string[];
}

/** `repo` is the checked-out working tree; `content` is wherever the wiki and tasks live. */
export type Scope = "repo" | "content";

export interface FileContent {
  readonly scope: Scope;
  readonly path: string;
  readonly content: string;
  readonly hash: string;
}

export type DiffSource = "worktree" | "index" | { readonly commit: string };

export interface Diff {
  readonly path: string;
  readonly original: string;
  readonly modified: string;
  readonly binary: boolean;
}

export interface Commit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly email: string;
  readonly date: string;
  readonly subject: string;
  readonly refs: readonly string[];
}

export interface CommitFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: string;
}

export interface CommitDetail {
  readonly commit: Commit;
  readonly body: string;
  readonly files: readonly CommitFile[];
}

export type SyncAction = "fetch" | "pull" | "push";

export interface RecentEntry {
  readonly location: Location;
  readonly name: string;
  readonly openedAt: number;
  /** The repository's remote URLs when it was last seen, so GitDesk links find it. */
  readonly remotes: readonly string[];
}

export type Theme = "system" | "light" | "dark";

export interface Preferences {
  readonly theme: Theme;
  readonly reopenLast: boolean;
  readonly autoSyncContent: boolean;
}

/** What a terminal printed since the last read (possibly nothing yet), or its exit code once it ended and everything was read. */
export type TerminalOutput = { readonly data: string } | { readonly exit: number };

/** An open repository: `id` names it in every later call, so calls racing a switch fail cleanly. */
export interface OpenedWorkspace {
  readonly id: string;
  readonly snapshot: Snapshot;
}

export const sameLocation = (a: Location, b: Location): boolean =>
  a.kind === b.kind &&
  a.path === b.path &&
  (a.kind !== "wsl" || a.distro === (b as typeof a).distro) &&
  (a.kind !== "ssh" || a.host === (b as typeof a).host);

export const describeLocation = (location: Location): string =>
  location.kind === "local"
    ? location.path
    : location.kind === "wsl"
      ? `${location.distro}:${location.path}`
      : `${location.host}:${location.path}`;
