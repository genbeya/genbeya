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

/** Project settings, stored in `.gitdesk.yml` next to the wiki and tasks. */
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
