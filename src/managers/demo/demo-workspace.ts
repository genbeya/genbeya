/**
 * An open repository of the web demo, shared by its managers: the
 * in-memory repository, its working tree as a file store, the settings, and
 * the queue that runs operations one at a time, as `Workspace` is for
 * the app's managers.
 */
import type { Location, PullRequest, Settings, Task } from "../../contracts/model";
import { FileStore } from "../../access/files/file-store";
import { MemoryHost } from "../../access/memory/memory-host";
import type { MemoryRepository } from "../../access/memory/memory-repository";
import type { SettingsEngine } from "../../engines/settings-engine";
import type { PullEngine } from "../../engines/pull-engine";
import type { TaskEngine } from "../../engines/task-engine";
import { baseName, validateRepositoryPath } from "../../utilities/repository-path";
import { SerialQueue } from "../../utilities/serial-queue";
import { readPulls, readSettings, readTasks, type LoadedSettings } from "../workspace";

const CLOSED = "This repository is no longer open.";

export interface DemoEngines {
  readonly settings: SettingsEngine;
  readonly tasks: TaskEngine;
  readonly pulls: PullEngine;
}

export class DemoWorkspace {
  /** The working tree. */
  readonly files: FileStore;
  private readonly queue = new SerialQueue();
  private loadedSettings: LoadedSettings | null = null;
  private closed = false;

  constructor(
    readonly location: Location,
    readonly repository: MemoryRepository,
    private readonly engines: DemoEngines,
  ) {
    this.files = new FileStore(new MemoryHost(repository), location.path);
  }

  /** Runs operations on this repository one at a time. */
  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error(CLOSED));
    return this.queue.run(operation);
  }

  /** A validated repository-relative path; see `Workspace.path`. */
  path(value: unknown): string {
    return validateRepositoryPath(value, false);
  }

  paths(values: unknown): string[] {
    if (!Array.isArray(values) || !values.length || values.length > 10_000) throw new Error("Select files first.");
    return values.map((value) => this.path(value));
  }

  get folderName(): string {
    return baseName(this.location.path);
  }

  /** The project settings, cached until an edit or `fresh` reads them again. */
  async settings(fresh = false): Promise<LoadedSettings> {
    if (this.loadedSettings && !fresh) return this.loadedSettings;
    return (this.loadedSettings = await readSettings(
      this.files,
      this.engines.settings.defaults(this.folderName),
      this.engines.settings,
      false,
    ));
  }

  forgetSettings(): void {
    this.loadedSettings = null;
  }

  tasks(files: readonly string[], settings: Settings, warnings: string[]): Promise<Task[]> {
    return readTasks(this.files, files, settings, this.engines.tasks, warnings);
  }

  pulls(files: readonly string[], settings: Settings, warnings: string[]): Promise<PullRequest[]> {
    return readPulls(this.files, files, settings, this.engines.pulls, warnings);
  }

  close(): void {
    this.closed = true;
  }
}

/** Open repositories by id; one is open at a time, as in the app's window. */
export class DemoRegistry {
  private readonly open = new Map<string, DemoWorkspace>();

  get(id: unknown): DemoWorkspace {
    const workspace = typeof id === "string" ? this.open.get(id) : undefined;
    if (!workspace) throw new Error(CLOSED);
    return workspace;
  }

  /** Registers `workspace` under a new id, closing every other one; a reopened one only gets the new id. */
  activate(workspace: DemoWorkspace): string {
    for (const [id, other] of this.open) {
      if (other !== workspace) other.close();
      this.open.delete(id);
    }
    const id = crypto.randomUUID();
    this.open.set(id, workspace);
    return id;
  }

  current(): DemoWorkspace | null {
    return this.open.values().next().value ?? null;
  }

  close(id: string): void {
    this.open.get(id)?.close();
    this.open.delete(id);
  }
}
