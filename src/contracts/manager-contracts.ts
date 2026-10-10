/**
 * The service contracts of the managers. Clients reach them through a
 * transport (Electron IPC, a Deno binding or in-page calls under Tauri);
 * every argument is validated by the manager, never trusted.
 */
import type {
  AgentFile,
  AgentFileWrite,
  AgentTarget,
  CommitDetail,
  Commit,
  Diff,
  DiffSource,
  FileContent,
  FolderListing,
  LinkUpdate,
  Location,
  OpenedWorkspace,
  PageMove,
  Preferences,
  RecentEntry,
  RemoteLocation,
  Scope,
  SearchOptions,
  SearchResults,
  Settings,
  Snapshot,
  StorageMode,
  SyncAction,
  Task,
  TaskActivity,
  TaskInput,
  TaskTemplate,
  TerminalOutput,
} from "./model";

/** Opening, closing and observing repositories; the user's recent list and preferences. */
export interface WorkspaceManagerContract {
  open(location: Location): Promise<OpenedWorkspace>;
  /** Reopens the repository requested at launch or, if the preference allows, the last one. */
  restore(launchArgs: readonly string[]): Promise<OpenedWorkspace | null>;
  clone(url: string, parent: Location): Promise<OpenedWorkspace>;
  /** Creates a sample repository to try GitDesk with in a new folder below `parent`, and opens it. */
  createSample(parent: Location): Promise<OpenedWorkspace>;
  close(workspace: string): Promise<void>;
  /** Resolves to null when nothing changed since `since`. */
  snapshot(workspace: string, since?: string): Promise<Snapshot | null>;
  recent(): Promise<readonly RecentEntry[]>;
  forget(location: Location): Promise<void>;
  preferences(): Promise<Preferences>;
  setPreferences(change: Partial<Preferences>): Promise<Preferences>;
  /** WSL distributions on this machine; empty elsewhere. */
  distributions(): Promise<readonly string[]>;
  /**
   * The subfolders of a folder on WSL or SSH, for choosing a path there. An
   * empty path, or one starting with `~`, is relative to the home folder.
   */
  browse(location: RemoteLocation): Promise<FolderListing>;
}

/** Everything that edits files: repository files, wiki pages, tasks, settings and the files that teach coding agents to use them. */
export interface ContentManagerContract {
  read(workspace: string, scope: Scope, path: string): Promise<FileContent>;
  /** An image as a data URL, for showing inside pages. */
  image(workspace: string, scope: Scope, path: string): Promise<string>;
  /** `expectedHash` is the version the edit is based on, or null for a new file. */
  write(workspace: string, scope: Scope, path: string, content: string, expectedHash: string | null): Promise<FileContent>;
  remove(workspace: string, scope: Scope, path: string): Promise<void>;
  createPage(workspace: string, path: string): Promise<FileContent>;
  /** The links that moving a page with its subpages would rewrite. */
  pageLinks(workspace: string, from: string, to: string): Promise<readonly LinkUpdate[]>;
  /** Moves a page together with its subpages, in one commit with the link updates if asked; resolves to the new path. */
  movePage(workspace: string, from: string, to: string, options?: PageMove): Promise<string>;
  deletePage(workspace: string, path: string): Promise<void>;
  createTask(workspace: string, input: TaskInput): Promise<Task>;
  updateTask(workspace: string, path: string, input: TaskInput, expectedHash: string): Promise<Task>;
  deleteTask(workspace: string, path: string): Promise<void>;
  /** What a new task of `type` starts with, from the type's template; null without one. */
  taskTemplate(workspace: string, type: string): Promise<TaskTemplate | null>;
  /** The template file of `type`, created with an outline when missing; resolves to its path. */
  ensureTaskTemplate(workspace: string, type: string): Promise<string>;
  /**
   * Who changed the task and how, newest first, from the Git history of its
   * file, following moves between epics. Edits not committed yet come first.
   */
  taskActivity(workspace: string, path: string): Promise<readonly TaskActivity[]>;
  /** The name new comments are signed with: Git's user name in the repository. */
  commentAuthor(workspace: string): Promise<string>;
  /** Appends a comment to the task's file, whatever else changed in it meanwhile. */
  addComment(workspace: string, path: string, text: string): Promise<Task>;
  /** Changes one of the user's own comments; `index` counts the comments of the version `expectedHash`. */
  editComment(workspace: string, path: string, index: number, text: string, expectedHash: string): Promise<Task>;
  deleteComment(workspace: string, path: string, index: number, expectedHash: string): Promise<Task>;
  saveSettings(workspace: string, settings: Settings, expectedHash: string | null): Promise<void>;
  /** Keeps wiki and tasks in the checkout, or on a dedicated branch shared by all code branches. */
  setStorage(workspace: string, mode: StorageMode): Promise<void>;
  /** Exchanges wiki and task edits on the dedicated branch with its remote. */
  syncContent(workspace: string): Promise<void>;
  /** Every agent file and whether the checkout has it, generated as if `targets` were added (they refer to each other). */
  agentFiles(workspace: string, targets: readonly AgentTarget[]): Promise<readonly AgentFile[]>;
  /** Writes the agent files of `targets` into the checkout, leaving text outside GitDesk's blocks alone. */
  addAgentFiles(workspace: string, targets: readonly AgentTarget[]): Promise<readonly AgentFileWrite[]>;
  /**
   * Finds `text` inside pages, tasks and code: tracked and untracked files
   * that .gitignore does not exclude, binary files skipped. Literal and
   * ignoring case unless `options` say otherwise; bounded in files, matches
   * per file and line length.
   */
  search(workspace: string, text: string, options?: SearchOptions): Promise<SearchResults>;
}

/** Staging, committing, history, branches and remotes of the checked-out repository. */
export interface VersionControlManagerContract {
  diff(workspace: string, path: string, source: DiffSource, oldPath?: string): Promise<Diff>;
  stage(workspace: string, paths: readonly string[]): Promise<void>;
  unstage(workspace: string, paths: readonly string[]): Promise<void>;
  /** Reverts working-tree edits to the staged version and deletes untracked files. */
  discard(workspace: string, paths: readonly string[]): Promise<void>;
  commit(workspace: string, message: string, amend: boolean): Promise<void>;
  lastCommitMessage(workspace: string): Promise<string>;
  log(workspace: string, skip: number, limit: number): Promise<readonly Commit[]>;
  commitDetail(workspace: string, hash: string): Promise<CommitDetail>;
  switchBranch(workspace: string, name: string): Promise<void>;
  createBranch(workspace: string, name: string): Promise<void>;
  sync(workspace: string, action: SyncAction, remote: string): Promise<void>;
  setRemote(workspace: string, name: string, url: string): Promise<void>;
  removeRemote(workspace: string, name: string): Promise<void>;
}

/**
 * Shells in the repository, on the repository's machine. Terminals belong to
 * the repository and end when it closes. Output is collected by reading in a
 * loop, so it reaches the client over any request and reply bridge.
 */
export interface TerminalManagerContract {
  /** False when this build cannot open terminals. */
  available(): Promise<boolean>;
  /** Starts the user's shell in the repository's root; resolves to the terminal's id. */
  open(workspace: string, cols: number, rows: number): Promise<string>;
  write(terminal: string, data: string): Promise<void>;
  resize(terminal: string, cols: number, rows: number): Promise<void>;
  /** Waits for output, up to half a minute; after the last output it resolves to the exit code. */
  read(terminal: string): Promise<TerminalOutput>;
  /** Ends the shell. */
  close(terminal: string): Promise<void>;
}

export interface Managers {
  readonly workspace: WorkspaceManagerContract;
  readonly content: ContentManagerContract;
  readonly versionControl: VersionControlManagerContract;
  readonly terminal: TerminalManagerContract;
}

type Methods<T> = readonly (keyof T & string)[];

/** Every callable method, per manager. Transports dispatch only these names. */
export const MANAGER_METHODS = {
  workspace: [
    "open",
    "restore",
    "clone",
    "createSample",
    "close",
    "snapshot",
    "recent",
    "forget",
    "preferences",
    "setPreferences",
    "distributions",
    "browse",
  ],
  content: [
    "read",
    "image",
    "write",
    "remove",
    "createPage",
    "pageLinks",
    "movePage",
    "deletePage",
    "createTask",
    "updateTask",
    "deleteTask",
    "taskTemplate",
    "ensureTaskTemplate",
    "taskActivity",
    "commentAuthor",
    "addComment",
    "editComment",
    "deleteComment",
    "saveSettings",
    "setStorage",
    "syncContent",
    "agentFiles",
    "addAgentFiles",
    "search",
  ],
  versionControl: [
    "diff",
    "stage",
    "unstage",
    "discard",
    "commit",
    "lastCommitMessage",
    "log",
    "commitDetail",
    "switchBranch",
    "createBranch",
    "sync",
    "setRemote",
    "removeRemote",
  ],
  terminal: ["available", "open", "write", "resize", "read", "close"],
} as const satisfies { [K in keyof Managers]: Methods<Managers[K]> };

export type ManagerName = keyof Managers;
