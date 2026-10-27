/**
 * One open repository, shared by the managers: its host, access objects,
 * settings, the queue that runs its operations one at a time, and what has
 * to end with it or with the client using it (terminals).
 */
import type { ContentArea, Location, PullRequest, Scope, Settings, Task } from "../contracts/model";
import { ContentStore, type ContentLocation } from "../access/content/content-store";
import { FileStore } from "../access/files/file-store";
import type { RepositoryAccess } from "../access/git/repository-access";
import { isMissing, type Host } from "../access/hosts/host";
import { contentAreaOf, SETTINGS_FILE, type SettingsEngine } from "../engines/settings-engine";
import type { PullEngine } from "../engines/pull-engine";
import type { TaskEngine } from "../engines/task-engine";
import { baseName, validateRepositoryPath } from "../utilities/repository-path";
import { SerialQueue } from "../utilities/serial-queue";

const CLOSED = "This repository is no longer open.";
/** How long quitting waits for running operations before cutting them off. */
const CLOSE_GRACE = 10_000;

export interface LoadedSettings {
  readonly settings: Settings;
  /** Version of the settings file; null while it does not exist. */
  readonly hash: string | null;
  /** Why the file could not be used; defaults apply meanwhile. */
  readonly problem?: string;
}

export interface Engines {
  readonly settings: SettingsEngine;
  readonly tasks: TaskEngine;
  readonly pulls: PullEngine;
}

/** The settings in `files`: `fallback` while there are none, and also, saying why, while they are broken. */
export async function readSettings(
  files: FileStore,
  fallback: Settings,
  engine: SettingsEngine,
  windows: boolean,
): Promise<LoadedSettings> {
  let file;
  try {
    file = await files.read(SETTINGS_FILE);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return { settings: fallback, hash: null };
  }
  try {
    return { settings: engine.parse(file.content, fallback, windows), hash: file.hash };
  } catch (error) {
    // A broken settings file must not lock anyone out of the settings screen.
    return {
      settings: fallback,
      hash: file.hash,
      problem: `${SETTINGS_FILE}: ${(error as Error).message} Using defaults until it is fixed.`,
    };
  }
}

/** The tasks among `files`, read from `store`; problems, such as two tasks with one ID, become `warnings`. */
export async function readTasks(
  store: FileStore,
  files: readonly string[],
  settings: Settings,
  engine: TaskEngine,
  warnings: string[],
): Promise<Task[]> {
  const paths = files.filter((file) => engine.isTaskFile(file, settings.taskRoot));
  const contents = await store.readMany(paths);
  const tasks: Task[] = [];
  const owners = new Map<string, string>();
  contents.forEach((file, i) => {
    const path = paths[i]!;
    if (!file) {
      warnings.push(`${path}: could not be read.`);
      return;
    }
    if (file instanceof Error) {
      warnings.push(`${path}: ${file.message}`);
      return;
    }
    try {
      const task = engine.parse(path, file.content, file.hash, settings.taskRoot);
      const owner = owners.get(task.id);
      if (owner) warnings.push(`${path}: task ID ${task.id} is also used by ${owner}.`);
      else owners.set(task.id, path);
      tasks.push(task);
    } catch (error) {
      warnings.push(`${path}: ${(error as Error).message}`);
    }
  });
  return tasks;
}

/** The pull requests among `files`, read from `store`, by ID; problems become `warnings`. */
export async function readPulls(
  store: FileStore,
  files: readonly string[],
  settings: Settings,
  engine: PullEngine,
  warnings: string[],
): Promise<PullRequest[]> {
  const paths = files.filter((file) => engine.isPullFile(file, settings.pullRoot));
  const contents = await store.readMany(paths);
  const pulls: PullRequest[] = [];
  contents.forEach((file, i) => {
    const path = paths[i]!;
    if (!file || file instanceof Error)
      return void warnings.push(`${path}: ${file instanceof Error ? file.message : "could not be read."}`);
    try {
      pulls.push(engine.parse(path, file.content, file.hash));
    } catch (error) {
      warnings.push(`${path}: ${(error as Error).message}`);
    }
  });
  const number = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  return pulls.sort((a, b) => number(a.id) - number(b.id));
}

export class Workspace {
  readonly checkout: FileStore;
  readonly content: ContentStore;
  private readonly queue = new SerialQueue();
  private loadedSettings: LoadedSettings | null = null;
  private closed = false;
  private readonly releaseListeners = new Set<() => void>();

  constructor(
    readonly location: Location,
    readonly host: Host,
    readonly repository: RepositoryAccess,
    private readonly engines: Engines,
  ) {
    this.checkout = new FileStore(host, repository.root);
    this.content = new ContentStore(host, repository.git, this.checkout);
  }

  /** Runs operations on this repository one at a time. */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error(CLOSED));
    return this.queue.run(operation);
  }

  /** Whether the repository lives on a Windows file system, where names such as `GIT~1` are aliases. */
  get windows(): boolean {
    return this.host.paths.separator === "\\";
  }

  /** A validated repository-relative path; Windows hosts also reject Windows aliases. */
  path(value: unknown): string {
    return validateRepositoryPath(value, this.windows);
  }

  paths(values: unknown): string[] {
    if (!Array.isArray(values) || !values.length || values.length > 10_000) throw new Error("Select files first.");
    return values.map((value) => this.path(value));
  }

  /** The files `path` is read from and written to in `scope`. */
  async files(scope: Scope, path: string): Promise<FileStore> {
    if (scope === "repo") return this.checkout;
    if (scope === "content") return (await this.locateContent(path)).files;
    throw new Error("Invalid scope.");
  }

  /**
   * The area a content path belongs to: the settings file, the task folder,
   * or the wiki, which also takes whatever else pages link to, such as images.
   */
  async areaOf(path: string): Promise<ContentArea> {
    return contentAreaOf(path, (await this.settings()).settings) ?? "wiki";
  }

  /** Where the content file `path` lives: the checkout, or the content branch's worktree. */
  async locateContent(path: string): Promise<ContentLocation> {
    return this.content.locate(await this.areaOf(path));
  }

  get folderName(): string {
    return baseName(this.repository.root.replace(/\\/g, "/"));
  }

  /**
   * The project settings; a broken file falls back to defaults and says why.
   * Cached for validating edits; `fresh` re-reads the file, which other
   * programs may have changed.
   */
  async settings(fresh = false): Promise<LoadedSettings> {
    if (this.loadedSettings && !fresh) return this.loadedSettings;
    const files = (await this.content.locate("settings")).files;
    return (this.loadedSettings = await readSettings(
      files,
      this.engines.settings.defaults(this.folderName),
      this.engines.settings,
      this.windows,
    ));
  }

  forgetSettings(): void {
    this.loadedSettings = null;
  }

  /** Reads every task file below the task folder; problems become `warnings`. */
  async tasks(files: readonly string[], settings: Settings, warnings: string[]): Promise<Task[]> {
    return readTasks((await this.content.locate("tasks")).files, files, settings, this.engines.tasks, warnings);
  }

  /** Reads every pull request file in the pull request folder; problems become `warnings`. */
  async pulls(files: readonly string[], settings: Settings, warnings: string[]): Promise<PullRequest[]> {
    return readPulls((await this.content.locate("pulls")).files, files, settings, this.engines.pulls, warnings);
  }

  /**
   * Calls `listener` once the client using the repository lets go of it: the
   * repository closes (at once if it has), or a reloaded client takes it
   * over. The returned function cancels that.
   */
  onRelease(listener: () => void): () => void {
    if (this.closed) listener();
    else this.releaseListeners.add(listener);
    return () => this.releaseListeners.delete(listener);
  }

  /** A new client takes the repository over; what the previous one started ends. */
  handOver(): void {
    this.release();
  }

  /**
   * Refuses new operations, lets queued ones finish (an interrupted commit or
   * rebase on a remote machine would leave the repository half-changed),
   * then disconnects.
   */
  close(): Promise<void> {
    this.markClosed();
    return this.queue.run(async () => this.host.dispose());
  }

  /** Disconnects now, interrupting a running operation. */
  dispose(): void {
    this.markClosed();
    this.host.dispose();
  }

  private markClosed() {
    this.closed = true;
    this.release();
  }

  private release() {
    for (const listener of this.releaseListeners) listener();
    this.releaseListeners.clear();
  }
}

/** True when `promise` settles within `ms`; the timer never outlives it. */
async function settlesWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<false>((resolve) => (timer = setTimeout(() => resolve(false), ms)));
  try {
    return await Promise.race([promise.then(() => true), expired]);
  } finally {
    clearTimeout(timer);
  }
}

/** Open repositories by id. One window shows one repository, so opening another closes the rest. */
export class WorkspaceRegistry {
  private readonly open = new Map<string, Workspace>();
  /** Closed repositories whose queued operations are still running. */
  private readonly closing = new Map<Workspace, Promise<void>>();

  get(id: unknown): Workspace {
    const workspace = typeof id === "string" ? this.open.get(id) : undefined;
    if (!workspace) throw new Error(CLOSED);
    return workspace;
  }

  /**
   * Registers `workspace` under a new id, closing every other one. An open
   * workspace is handed over: its old id stops working, and so do the
   * terminals the previous client left behind.
   */
  activate(workspace: Workspace): string {
    for (const [id, other] of this.open) if (other !== workspace) void this.close(id);
    for (const [id, other] of this.open)
      if (other === workspace) {
        this.open.delete(id);
        workspace.handOver();
      }
    const id = crypto.randomUUID();
    this.open.set(id, workspace);
    return id;
  }

  /** The open repository, if any. */
  current(): Workspace | null {
    return this.open.values().next().value ?? null;
  }

  /** Closes a repository; resolves once its queued operations finished and it disconnected. */
  close(id: string): Promise<void> {
    const workspace = this.open.get(id);
    if (!workspace) return Promise.resolve();
    this.open.delete(id);
    const closed = workspace.close().finally(() => this.closing.delete(workspace));
    this.closing.set(workspace, closed);
    return closed;
  }

  /** Closes every repository, cutting off operations still running after `grace` ms, so quitting never hangs. */
  async closeAll(grace = CLOSE_GRACE): Promise<void> {
    for (const id of [...this.open.keys()]) void this.close(id);
    const pending = [...this.closing.keys()];
    if (!(await settlesWithin(Promise.all(this.closing.values()), grace))) for (const workspace of pending) workspace.dispose();
  }
}
