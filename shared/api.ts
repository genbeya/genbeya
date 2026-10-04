/** Contracts shared by the core engine, the Electron main process and the renderer. */

export type Location =
  | { kind: "local"; path: string }
  | { kind: "wsl"; distro: string; path: string }
  | { kind: "ssh"; host: string; path: string };

export const PRIORITIES = ["urgent", "high", "medium", "low", "none"] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Settings {
  name: string;
  wikiRoot: string;
  wikiHome: string;
  taskRoot: string;
  taskPrefix: string;
  statuses: string[];
}

export interface FileNode {
  name: string;
  path: string;
  children?: FileNode[];
}

export interface WikiNode {
  title: string;
  /** The page file, or null for a directory without a matching page. */
  path: string | null;
  /** The directory holding subpages, if any. */
  dir: string | null;
  children: WikiNode[];
}

export interface Task {
  id: string;
  path: string;
  title: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string[];
  body: string;
  hash: string;
}

export type TaskInput = Pick<
  Task,
  "title" | "status" | "priority" | "assignee" | "labels" | "body"
>;

export interface Change {
  path: string;
  oldPath?: string;
  /** Porcelain v1 index status letter (" " when unchanged). */
  index: string;
  /** Porcelain v1 working-tree status letter (" " when unchanged). */
  worktree: string;
}

export interface Remote {
  name: string;
  url: string;
}

export interface Head {
  branch: string | null;
  /** Short commit id when detached, null on an unborn branch. */
  commit: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
}

export type Storage =
  | { mode: "worktree" }
  | {
      mode: "branch";
      branch: string;
      remote: string | null;
      ahead: number;
      behind: number;
    };

export interface Snapshot {
  version: string;
  location: Location;
  settings: Settings;
  settingsHash: string | null;
  storage: Storage;
  head: Head;
  branches: string[];
  /** Remote-tracking branches without a local counterpart, e.g. `origin/feature`. */
  remoteBranches: string[];
  remotes: Remote[];
  changes: Change[];
  files: FileNode[];
  wiki: WikiNode[];
  tasks: Task[];
  warnings: string[];
}

/** `repo` is the checked-out working tree; `content` is where wiki and tasks live. */
export type Scope = "repo" | "content";

export interface FileContent {
  scope: Scope;
  path: string;
  content: string;
  hash: string;
}

export type DiffSource = "worktree" | "index" | { commit: string };

export interface Diff {
  path: string;
  original: string;
  modified: string;
  binary: boolean;
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: string;
  subject: string;
  refs: string[];
}

export interface CommitFile {
  path: string;
  oldPath?: string;
  status: string;
}

export interface CommitDetail {
  commit: Commit;
  body: string;
  files: CommitFile[];
}

export interface WorkspaceAPI {
  /** Resolves to null when nothing changed since `since`. */
  snapshot(since?: string): Promise<Snapshot | null>;
  read(scope: Scope, path: string): Promise<FileContent>;
  /** A repository image as a data URL, for rendering inside wiki pages. */
  image(scope: Scope, path: string): Promise<string>;
  write(
    scope: Scope,
    path: string,
    content: string,
    expectedHash: string | null,
  ): Promise<FileContent>;
  /** Deletes a file (not a folder) from the working tree. */
  remove(scope: Scope, path: string): Promise<void>;
  createPage(path: string): Promise<FileContent>;
  movePage(from: string, to: string): Promise<string>;
  deletePage(path: string): Promise<void>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(path: string, input: TaskInput, expectedHash: string): Promise<Task>;
  deleteTask(path: string): Promise<void>;
  diff(path: string, source: DiffSource, oldPath?: string): Promise<Diff>;
  stage(paths: string[]): Promise<void>;
  unstage(paths: string[]): Promise<void>;
  discard(paths: string[]): Promise<void>;
  commit(message: string, amend: boolean): Promise<void>;
  lastCommitMessage(): Promise<string>;
  log(skip: number, limit: number): Promise<Commit[]>;
  commitDetail(hash: string): Promise<CommitDetail>;
  switchBranch(name: string): Promise<void>;
  createBranch(name: string): Promise<void>;
  sync(action: "fetch" | "pull" | "push", remote: string): Promise<void>;
  setRemote(name: string, url: string): Promise<void>;
  removeRemote(name: string): Promise<void>;
  saveSettings(settings: Settings, expectedHash: string | null): Promise<void>;
  setStorage(mode: "worktree" | "branch"): Promise<void>;
  syncContent(): Promise<void>;
}

export interface RecentEntry {
  location: Location;
  name: string;
  openedAt: number;
}

export interface Preferences {
  theme: "system" | "light" | "dark";
  reopenLast: boolean;
  autoSyncContent: boolean;
  plantumlServer: string;
}

export interface DesktopAPI extends WorkspaceAPI {
  /** Shows a folder picker; a picked `\\wsl$` path opens through WSL. */
  pickFolder(): Promise<Location | null>;
  open(location: Location): Promise<Snapshot>;
  /** Reopens the last workspace when the preference allows it. */
  restore(): Promise<Snapshot | null>;
  clone(url: string, parent: Location): Promise<Snapshot>;
  close(): Promise<void>;
  recent(): Promise<RecentEntry[]>;
  forget(location: Location): Promise<void>;
  wslDistros(): Promise<string[]>;
  preferences(): Promise<Preferences>;
  setPreferences(value: Partial<Preferences>): Promise<Preferences>;
  plantuml(source: string): Promise<string>;
  openExternal(url: string): Promise<void>;
  /** Absolute host path of a scope root, for "reveal" and copy actions. */
  rootPath(scope: Scope): Promise<string>;
  /** Called when a repository should open (e.g. picked from the jump list). */
  onOpenRequest?(callback: (location: Location) => void): () => void;
}

export const sameLocation = (a: Location, b: Location) =>
  a.kind === b.kind &&
  a.path === b.path &&
  (a.kind !== "wsl" || a.distro === (b as typeof a).distro) &&
  (a.kind !== "ssh" || a.host === (b as typeof a).host);

export const describeLocation = (l: Location) =>
  l.kind === "local"
    ? l.path
    : l.kind === "wsl"
      ? `${l.distro}:${l.path}`
      : `${l.host}:${l.path}`;
