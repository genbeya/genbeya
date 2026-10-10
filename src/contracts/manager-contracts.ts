/**
 * The service contracts of the managers. Clients reach them through a
 * transport (Electron IPC, a Deno binding or in-page calls under Tauri);
 * every argument is validated by the manager, never trusted.
 */
import type {
  CommitDetail,
  Commit,
  Diff,
  DiffSource,
  FileContent,
  FolderListing,
  Location,
  OpenedWorkspace,
  Preferences,
  RecentEntry,
  RemoteLocation,
  Scope,
  Settings,
  Snapshot,
  StorageMode,
  SyncAction,
  Task,
  TaskInput,
  TerminalOutput,
} from "./model";

/** Opening, closing and observing repositories; the user's recent list and preferences. */
export interface WorkspaceManagerContract {
  open(location: Location): Promise<OpenedWorkspace>;
  /** Reopens the repository requested at launch or, if the preference allows, the last one. */
  restore(launchArgs: readonly string[]): Promise<OpenedWorkspace | null>;
  clone(url: string, parent: Location): Promise<OpenedWorkspace>;
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

/** Everything that edits files: repository files, wiki pages, tasks and settings. */
export interface ContentManagerContract {
  read(workspace: string, scope: Scope, path: string): Promise<FileContent>;
  /** An image as a data URL, for showing inside pages. */
  image(workspace: string, scope: Scope, path: string): Promise<string>;
  /** `expectedHash` is the version the edit is based on, or null for a new file. */
  write(workspace: string, scope: Scope, path: string, content: string, expectedHash: string | null): Promise<FileContent>;
  remove(workspace: string, scope: Scope, path: string): Promise<void>;
  createPage(workspace: string, path: string): Promise<FileContent>;
  /** Moves a page together with its subpages; resolves to the new path. */
  movePage(workspace: string, from: string, to: string): Promise<string>;
  deletePage(workspace: string, path: string): Promise<void>;
  createTask(workspace: string, input: TaskInput): Promise<Task>;
  updateTask(workspace: string, path: string, input: TaskInput, expectedHash: string): Promise<Task>;
  deleteTask(workspace: string, path: string): Promise<void>;
  saveSettings(workspace: string, settings: Settings, expectedHash: string | null): Promise<void>;
  /** Keeps wiki and tasks in the checkout, or on a dedicated branch shared by all code branches. */
  setStorage(workspace: string, mode: StorageMode): Promise<void>;
  /** Exchanges wiki and task edits on the dedicated branch with its remote. */
  syncContent(workspace: string): Promise<void>;
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
    "movePage",
    "deletePage",
    "createTask",
    "updateTask",
    "deleteTask",
    "saveSettings",
    "setStorage",
    "syncContent",
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
