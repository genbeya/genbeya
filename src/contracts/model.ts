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
  /** The description: the Markdown above the comments. */
  readonly body: string;
  /** The folder below the task folder that holds the task ("Auth/Tokens"); "" for none. */
  readonly epic: string;
  /** Version of the file the task was read from; updates must name it. */
  readonly hash: string;
  /** Oldest first, as they appear at the end of the file. */
  readonly comments: readonly TaskComment[];
}

export type TaskInput = Pick<Task, "title" | "status" | "priority" | "assignee" | "labels" | "body" | "epic">;

export interface TaskComment {
  readonly author: string;
  /** ISO 8601, to the minute, with the writer's UTC offset when the file has it. */
  readonly date: string;
  /** Markdown. */
  readonly body: string;
}

/** A property whose change the activity of a task names with its old and new value. */
export type TaskField = "title" | "status" | "priority" | "assignee" | "epic";

/** One thing a commit changed about a task, derived from its file before and after. */
export type TaskChange =
  | { readonly kind: "created" }
  | { readonly kind: "field"; readonly field: TaskField; readonly from: string; readonly to: string }
  | { readonly kind: "labels"; readonly added: readonly string[]; readonly removed: readonly string[] }
  | { readonly kind: "description" }
  | { readonly kind: "comments"; readonly added: number; readonly edited: number; readonly removed: number }
  /** Frontmatter fields GitDesk has no words for. */
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
