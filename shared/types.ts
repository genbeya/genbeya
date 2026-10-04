export interface Settings {
  name: string;
  wikiRoot: string;
  wikiHome: string;
  taskRoot: string;
  statuses: string[];
}
export interface FileNode {
  name: string;
  path: string;
  directory: boolean;
  children?: FileNode[];
}
export interface WikiNode {
  title: string;
  path: string | null;
  directory?: string;
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
  error?: string;
}
export interface Change {
  path: string;
  oldPath?: string;
  index: string;
  worktree: string;
}
export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  subject: string;
  refs: string;
}
export interface Remote {
  name: string;
  url: string;
}
export interface Snapshot {
  repo: string;
  settings: Settings;
  settingsHash: string | null;
  branch: string;
  branches: string[];
  changes: Change[];
  commits: Commit[];
  remotes: Remote[];
  files: FileNode[];
  wiki: WikiNode[];
  tasks: Task[];
  warnings: string[];
}
export interface FileContent {
  path: string;
  content: string;
  hash: string;
}
export interface Diff {
  path: string;
  original: string;
  modified: string;
  patch: string;
}
export interface TaskInput {
  title: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string[];
  body: string;
}
export interface EngineAPI {
  snapshot(): Promise<Snapshot>;
  read(path: string): Promise<FileContent>;
  save(
    path: string,
    content: string,
    expectedHash: string | null,
  ): Promise<FileContent>;
  createPage(path: string, title: string): Promise<FileContent>;
  createTask(input: TaskInput): Promise<Task>;
  updateTask(
    path: string,
    input: TaskInput,
    expectedHash: string,
  ): Promise<Task>;
  diff(path: string, staged: boolean, commit?: string): Promise<Diff>;
  stage(path: string): Promise<void>;
  unstage(path: string): Promise<void>;
  commit(message: string): Promise<void>;
  switchBranch(name: string): Promise<void>;
  createBranch(name: string): Promise<void>;
  sync(action: "fetch" | "pull" | "push", remote: string): Promise<void>;
  setRemote(name: string, url: string): Promise<void>;
  saveSettings(settings: Settings, expectedHash: string | null): Promise<void>;
  commitFiles(hash: string): Promise<string[]>;
}
export interface DesktopAPI extends EngineAPI {
  openRepository(): Promise<boolean>;
  cloneRepository(url: string): Promise<boolean>;
  createDemo(): Promise<boolean>;
}
