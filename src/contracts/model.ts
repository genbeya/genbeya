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

/** Colours for task types, named like the theme's colour tokens. */
export const TONES = ["gray", "blue", "green", "yellow", "orange", "red", "purple"] as const;
export type Tone = (typeof TONES)[number];

/** A kind of task, such as a bug. `icon` names a Lucide icon ("trending-up"). */
export interface TaskType {
  readonly name: string;
  readonly icon: string;
  readonly tone?: Tone;
}

export const GENERIC_TYPE_ICON = "circle-dot";

const KNOWN_TYPES: Readonly<Record<string, Omit<TaskType, "name">>> = {
  bug: { icon: "bug", tone: "red" },
  feature: { icon: "sparkles", tone: "purple" },
  improvement: { icon: "trending-up", tone: "blue" },
  chore: { icon: "wrench", tone: "gray" },
  task: { icon: "square-check", tone: "blue" },
  story: { icon: "book-open", tone: "green" },
  docs: { icon: "file-text", tone: "green" },
  question: { icon: "circle-question-mark", tone: "yellow" },
  research: { icon: "flask-conical", tone: "orange" },
};

/** A type of this name with its usual icon and colour: well-known names have their own, others a generic icon. */
export const taskType = (name: string): TaskType => ({ name, ...(KNOWN_TYPES[name.toLowerCase()] ?? { icon: GENERIC_TYPE_ICON }) });

export const FIELD_TYPES = ["text", "number", "date", "choice"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** A custom task field: a frontmatter key with an editor. Dates are written as `YYYY-MM-DD`. */
export interface FieldDefinition {
  readonly name: string;
  readonly type: FieldType;
  /** The values of a choice field. */
  readonly options?: readonly string[];
}

/** The frontmatter keys GitDesk writes itself; the epic is the task's folder. Custom fields use other names. */
export const TASK_KEYS = ["id", "title", "type", "status", "priority", "assignee", "labels", "epic"] as const;

/** The value of a custom field; an empty string removes the field. */
export type FieldValue = string | number | boolean;

/** Project settings, stored in `.genbeya.yml` next to the wiki and tasks. */
export interface Settings {
  readonly name: string;
  readonly wikiRoot: string;
  readonly wikiHome: string;
  readonly taskRoot: string;
  readonly taskPrefix: string;
  readonly statuses: readonly string[];
  /** Icons of the workflow states that have one, by state; the others show their progress. */
  readonly statusIcons: Readonly<Record<string, string>>;
  /** Workflow states the board leaves out (the list still shows them). */
  readonly hiddenColumns: readonly string[];
  readonly types: readonly TaskType[];
  readonly fields: readonly FieldDefinition[];
  /** The project's people as the settings file lists them; they win over what Genbeya derives from Git. */
  readonly people: readonly PersonEntry[];
}

/** A person listed in the settings: the handle `@mentions` use, with the name and email shown for it. */
export interface PersonEntry {
  readonly handle: string;
  readonly name: string;
  readonly email?: string;
  /** Other names and emails that mean this person, as commits, assignees or comments write them. */
  readonly aliases?: readonly string[];
}

/** Someone who works on the repository: a commit author, assignee or comment author, or a person the settings list. */
export interface Person {
  /** Unique, ignoring case: `@handle` mentions this person. */
  readonly handle: string;
  readonly name: string;
  readonly email: string | null;
  /** Other names and emails that mean this person. */
  readonly aliases: readonly string[];
  /** Commits among the recent ones that the person authored. */
  readonly commits: number;
}

/** The repository's people, by handle; `me` is the handle of the user, as Git knows them, if among them. */
export interface People {
  readonly people: readonly Person[];
  readonly me: string | null;
}

/** What a new task of a type starts with, from `<taskRoot>/.templates/<type>.md`. */
export type TaskTemplate = Pick<TaskInput, "body"> & Partial<Pick<TaskInput, "priority" | "assignee" | "labels" | "fields">>;

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

/** A link that moving a page rewrites: its line, and its target before and after. */
export interface LinkChange {
  readonly line: number;
  readonly before: string;
  readonly after: string;
}

/** The links of one Markdown file that moving a page rewrites; `path` is where the file is before the move. */
export interface LinkUpdate {
  readonly path: string;
  readonly changes: readonly LinkChange[];
}

/** Options of moving a page. */
export interface PageMove {
  /** Rewrites the links to the moved pages, and the relative links inside them, in the same commit. */
  readonly updateLinks?: boolean;
}

export interface Task {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly assignee: string;
  readonly labels: readonly string[];
  /** One of the configured task types, or another name; "" for none. */
  readonly type: string;
  /** Other frontmatter fields with a plain value (text, number or true/false), by key. */
  readonly fields: Readonly<Record<string, FieldValue>>;
  /** The description: the Markdown above the comments. */
  readonly body: string;
  /** The folder below the task folder that holds the task ("Auth/Tokens"); "" for none. */
  readonly epic: string;
  /** Version of the file the task was read from; updates must name it. */
  readonly hash: string;
  /** Oldest first, as they appear at the end of the file. */
  readonly comments: readonly TaskComment[];
}

/**
 * A task as the client edits it. Updates leave the type as it is when `type`
 * is left out, and other fields that `fields` does not name.
 */
export type TaskInput = Pick<Task, "title" | "status" | "priority" | "assignee" | "labels" | "body" | "epic"> &
  Partial<Pick<Task, "type" | "fields">>;

export interface TaskComment {
  readonly author: string;
  /** ISO 8601, to the minute, with the writer's UTC offset when the file has it. */
  readonly date: string;
  /** Markdown. */
  readonly body: string;
}

/** A property whose change the activity of a task names with its old and new value. */
export type TaskField = "title" | "type" | "status" | "priority" | "assignee" | "epic";

/** One thing a commit changed about a task, derived from its file before and after. */
export type TaskChange =
  | { readonly kind: "created" }
  | { readonly kind: "field"; readonly field: TaskField; readonly from: string; readonly to: string }
  | { readonly kind: "labels"; readonly added: readonly string[]; readonly removed: readonly string[] }
  | { readonly kind: "description" }
  | { readonly kind: "comments"; readonly added: number; readonly edited: number; readonly removed: number }
  /** A custom field with a plain value, written as text; "" where the task did not have it. */
  | { readonly kind: "custom"; readonly field: string; readonly from: string; readonly to: string }
  /** Frontmatter fields GitDesk has no words for, such as lists. */
  | { readonly kind: "other"; readonly fields: readonly string[] };

/** A commit that changed a task, or its edits not committed yet. */
export interface TaskActivity {
  /** Null for edits not committed yet. */
  readonly commit: string | null;
  readonly author: string;
  /** ISO 8601; null for edits not committed yet. */
  readonly date: string | null;
  readonly subject: string;
  readonly changes: readonly TaskChange[];
}

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

/** The parts of a repository's GitDesk content that can each live in the checkout or on the content branch. */
export const CONTENT_AREAS = ["wiki", "tasks", "settings"] as const;
export type ContentArea = (typeof CONTENT_AREAS)[number];

/** `checkout`: next to the code, changing with the checked-out branch. `branch`: on the shared content branch. */
export const STORAGE_MODES = ["checkout", "branch"] as const;
export type StorageMode = (typeof STORAGE_MODES)[number];

export interface ContentBranch {
  readonly name: string;
  readonly remote: string | null;
  readonly ahead: number;
  readonly behind: number;
}

export interface Storage {
  readonly areas: Readonly<Record<ContentArea, StorageMode>>;
  /** The content branch while this clone uses one, whether or not an area lives on it; null otherwise. */
  readonly branch: ContentBranch | null;
}

/** True when the content branch has something to sync: an area lives on it, or it holds commits to push. */
export const syncsContentBranch = (storage: Storage): storage is Storage & { readonly branch: ContentBranch } =>
  storage.branch !== null && (CONTENT_AREAS.some((area) => storage.areas[area] === "branch") || storage.branch.ahead > 0);

/** Everything the client shows about an open repository, polled with {@link Snapshot.version}. */
export interface Snapshot {
  readonly version: string;
  readonly location: Location;
  readonly settings: Settings;
  /** Version of the settings file, null while it does not exist. */
  readonly settingsHash: string | null;
  /** The settings file: `.genbeya.yml`, or `.gitdesk.yml` in a repository GitDesk set up that has no `.genbeya.yml`. */
  readonly settingsFile: string;
  /** `.gitdesk.yml` next to `.genbeya.yml`, which wins: left over from GitDesk. Null without one. */
  readonly leftoverSettingsFile: string | null;
  /**
   * Shared files still named for GitDesk, Genbeya's former name, which
   * Genbeya reads as they are and can rename: `.gitdesk.yml` while it is the
   * settings file, `.gitdesk-content` on the content branch.
   */
  readonly legacyFiles: readonly string[];
  readonly storage: Storage;
  readonly head: Head;
  readonly branches: readonly string[];
  /** Remote-tracking branches without a local counterpart, such as `origin/feature`. */
  readonly remoteBranches: readonly string[];
  readonly remotes: readonly Remote[];
  /** Index letters compare the index with HEAD, or with HEAD's parent in snapshots taken while amending. */
  readonly changes: readonly Change[];
  readonly tags: readonly string[];
  /** Newest first. */
  readonly stashes: readonly Stash[];
  /** The merge, rebase, cherry-pick or revert in progress, if any. */
  readonly operation: Operation | null;
  /** The commit an amend replaces, when the snapshot compares staged changes with its parent. */
  readonly amending?: Amending;
  readonly files: readonly FileNode[];
  readonly wiki: readonly WikiNode[];
  readonly tasks: readonly Task[];
  readonly warnings: readonly string[];
}

/** `repo` is the checked-out working tree; `content` is wherever the path's area (wiki, tasks or settings) lives. */
export type Scope = "repo" | "content";

export interface FileContent {
  readonly scope: Scope;
  readonly path: string;
  readonly content: string;
  readonly hash: string;
}

export type DiffSource = "worktree" | "index" | { readonly commit: string };

/**
 * What staged changes are compared with: HEAD, or while amending, the commit
 * HEAD amends onto (its first parent; nothing for the first commit), so the
 * staged changes are those the amended commit will hold.
 */
export type ChangeBase = "head" | "parent";

export const CHANGE_BASES: readonly ChangeBase[] = ["head", "parent"];

/** The commit an amend replaces, described in snapshots compared with its parent. */
export interface Amending {
  /** Short commit id. */
  readonly commit: string;
  /** Short id of the first parent the staged changes are compared with; null for the first commit. */
  readonly parent: string | null;
  /** A merge commit: the amended commit keeps all its parents. */
  readonly merge: boolean;
  /** Remote branches that already have the commit, so amending it means force-pushing them. */
  readonly pushed: readonly string[];
}

export interface Diff {
  readonly path: string;
  readonly original: string;
  readonly modified: string;
  readonly binary: boolean;
  /** Version of both sides; staging lines names it, so lines chosen in an outdated diff are refused. */
  readonly version: string;
  /**
   * Git's changed lines, the ones hunks and lines are staged by, so the
   * diff shows them where git has them; absent for commits, and for files
   * GitDesk can only stage as a whole.
   */
  readonly changes?: readonly DiffChange[];
}

/**
 * A run of changed lines in git's diff of a file: `oldCount` lines of the
 * original from line `oldStart` become `newCount` lines of the modified
 * version from line `newStart`. 1-based; a side without lines starts at
 * the line the run comes before.
 */
export interface DiffChange {
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
}

/** 1-based line numbers `from` to `to`, both included. */
export interface LineRange {
  readonly from: number;
  readonly to: number;
}

/** Changed lines of a diff: removed ones by their number in the original, added ones by their number in the modified version. */
export interface LineSelection {
  readonly original: readonly LineRange[];
  readonly modified: readonly LineRange[];
}

/** Lines of one file's diff to stage, unstage or discard: hunks, or lines within them. */
export interface LinePatch {
  readonly path: string;
  /** The path in the original version of a renamed file. */
  readonly oldPath?: string;
  /** {@link Diff.version} of the diff the lines were chosen in. */
  readonly version: string;
  readonly lines: LineSelection;
}

/** What a .gitignore rule matches: the file itself, a folder, or every file with the file's extension. */
export type IgnoreKind = "file" | "folder" | "extension";

export const IGNORE_KINDS: readonly IgnoreKind[] = ["file", "folder", "extension"];

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

/**
 * What a reset keeps: `soft` the changes of the commits it leaves, staged;
 * `mixed` the same, unstaged; `hard` nothing, not even uncommitted changes;
 * `keep` uncommitted changes, refusing when the reset would overwrite them.
 */
export const RESET_MODES = ["soft", "mixed", "hard", "keep"] as const;
export type ResetMode = (typeof RESET_MODES)[number];

/** What resetting the current branch to a commit would do. */
export interface ResetPlan {
  readonly branch: string;
  /** The commit the branch is at, which the reset expects it still to be at. */
  readonly head: string;
  readonly target: string;
  /** Commits the branch would no longer contain. */
  readonly commits: number;
  readonly upstream: string | null;
  /** How many of those commits the upstream already has: they would come back as "behind". */
  readonly pushed: number;
  /** Tracked files with uncommitted changes, which a hard reset discards. */
  readonly uncommitted: readonly string[];
  /** Untracked and ignored files the target commit has and the branch has not, which hard and keep resets overwrite. */
  readonly overwritten: readonly string[];
  /** A fingerprint of the uncommitted changes and of those files, which hard and keep resets expect to be unchanged. */
  readonly state: string;
}

/** Where a reset moved the branch from and to, for undoing it. */
export interface ResetResult {
  readonly from: string;
  readonly to: string;
}

/** A remote to push to, as far as the last fetch knows it. */
export interface PushTarget {
  readonly remote: string;
  /** The branch the remote's HEAD names; null when unknown. */
  readonly defaultBranch: string | null;
  /** Its branches, as of the last fetch. */
  readonly branches: readonly string[];
}

/** Where a local branch can be pushed, and where it is set to push. */
export interface PushPlan {
  readonly branch: string;
  readonly upstream: { readonly remote: string; readonly branch: string } | null;
  readonly remotes: readonly PushTarget[];
}

/** Pushes local `branch` to `remoteBranch` on `remote`, whatever their names. */
export interface PushRequest {
  readonly branch: string;
  readonly remote: string;
  readonly remoteBranch: string;
  /** Makes the remote branch the upstream of `branch`. */
  readonly setUpstream: boolean;
  /**
   * Replaces the remote branch, but only while it is still at `expected`:
   * the commit of its remote-tracking branch the user reviewed (null when
   * there was none). Refused for the remote's default branch unless
   * `defaultBranch` is set.
   */
  readonly force?: { readonly expected: string | null; readonly defaultBranch: boolean };
}

/** `rejected`: the remote has commits the pushed branch lacks, so only a force push could replace them. */
export type PushOutcome = "done" | "rejected";

/** What force pushing a branch would replace. */
export interface ForcePushPlan {
  /** The remote branch's commit as last fetched, which the push expects; null when the last fetch saw no such branch. */
  readonly expected: string | null;
  /** Commits on the remote branch that the local branch lacks, newest first, up to 100: what others lose. */
  readonly removed: readonly Commit[];
  /** How many there are in all. */
  readonly total: number;
  /** Whether the remote branch is the remote's default branch. */
  readonly defaultBranch: boolean;
}

/** Whether `branch` is the remote's default branch; while that is unknown, main and master count as it. */
export const isDefaultBranch = (branch: string, defaultBranch: string | null): boolean =>
  defaultBranch === null ? branch === "main" || branch === "master" : branch === defaultBranch;

/**
 * Files that teach coding agents to use GitDesk's tasks and wiki: the skill
 * where Claude Code and where other agents look for it, and the instruction
 * files AGENTS.md, CLAUDE.md and Copilot's.
 */
export const AGENT_TARGETS = ["claudeSkill", "agentsSkill", "agents", "claude", "copilot"] as const;
export type AgentTarget = (typeof AGENT_TARGETS)[number];

export interface AgentFile {
  readonly target: AgentTarget;
  /** In the checkout. */
  readonly path: string;
  /** What GitDesk writes: the whole file, or its marked block in a file it shares with other text. */
  readonly text: string;
  /** `missing` also when the file exists without GitDesk's block. */
  readonly state: "missing" | "current" | "outdated";
  /** Excluded by `.gitignore`, so it would not be committed. */
  readonly ignored: boolean;
}

export interface AgentFileWrite {
  readonly path: string;
  readonly result: "created" | "updated" | "unchanged";
}

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
  /** A minimap beside code in the editor. */
  readonly minimap: boolean;
  /** The app version whose news the user has seen ("0.3.2"); null until the first start. */
  readonly lastSeenVersion: string | null;
  /** The user finished or ended the guided tour. */
  readonly tourSeen: boolean;
  /** The repositories that offered the tour, so each offers it once; see {@link repositoryKey}. */
  readonly tourOffered: readonly string[];
}

/** What a terminal printed since the last read (possibly nothing yet), or its exit code once it ended and everything was read. */
export type TerminalOutput = { readonly data: string } | { readonly exit: number };

/** How full-text search reads the query; every flag is off unless given. */
export interface SearchOptions {
  readonly caseSensitive?: boolean;
  /** The query is an extended regular expression (POSIX ERE) instead of literal text. */
  readonly regex?: boolean;
  /** Matches only whole words: no letter, digit or underscore right before or after. */
  readonly wholeWord?: boolean;
}

/** Characters `start` up to `end` of a line's text. */
export interface SearchRange {
  readonly start: number;
  readonly end: number;
}

export interface SearchMatch {
  /** 1-based. */
  readonly line: number;
  /** The line, shortened around the match with "…" when it is long. */
  readonly text: string;
  /** Where the query matches in `text`; empty when only git could tell. */
  readonly ranges: readonly SearchRange[];
  /** The lines around it, shortened likewise; null at the start or end of the file. */
  readonly before: string | null;
  readonly after: string | null;
}

export interface SearchHit {
  readonly path: string;
  readonly scope: Scope;
  /** The page or task title; the file name for code. */
  readonly title: string;
  readonly matches: readonly SearchMatch[];
}

export interface TaskSearchHit extends SearchHit {
  readonly id: string;
  readonly status: string;
}

/** Files whose text matches, by area. */
export interface SearchResults {
  readonly wiki: readonly SearchHit[];
  readonly tasks: readonly TaskSearchHit[];
  readonly code: readonly SearchHit[];
  /** More files or matches matched than are listed. */
  readonly truncated: boolean;
}

export type SearchArea = Exclude<keyof SearchResults, "truncated">;

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

/** Names a repository in preferences: "local:C:\code\app", "wsl:Ubuntu:/home/me/app". */
export const repositoryKey = (location: Location): string => `${location.kind}:${describeLocation(location)}`;
