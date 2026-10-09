/**
 * One open repository, shared by the managers: its host, access objects,
 * settings and the queue that runs its operations one at a time.
 */
import type { Location, Scope, Settings, Task } from "../contracts/model";
import { ContentStore } from "../access/content/content-store";
import { FileStore } from "../access/files/file-store";
import type { RepositoryAccess } from "../access/git/repository-access";
import { isMissing, type Host } from "../access/hosts/host";
import { SETTINGS_FILE, type SettingsEngine } from "../engines/settings-engine";
import type { TaskEngine } from "../engines/task-engine";
import { baseName, validateRepositoryPath, within } from "../utilities/repository-path";
import { SerialQueue } from "../utilities/serial-queue";

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
}

export class Workspace {
  readonly checkout: FileStore;
  readonly content: ContentStore;
  private readonly queue = new SerialQueue();
  private loadedSettings: LoadedSettings | null = null;

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
    return this.queue.run(operation);
  }

  /** A validated repository-relative path; Windows hosts also reject Windows aliases. */
  path(value: unknown): string {
    return validateRepositoryPath(value, this.host.paths.separator === "\\");
  }

  paths(values: unknown): string[] {
    if (!Array.isArray(values) || !values.length || values.length > 10_000) throw new Error("Select files first.");
    return values.map((value) => this.path(value));
  }

  async files(scope: Scope): Promise<FileStore> {
    if (scope === "repo") return this.checkout;
    if (scope === "content") return (await this.content.locate()).files;
    throw new Error("Invalid scope.");
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
    const fallback = this.engines.settings.defaults(this.folderName);
    const files = (await this.content.locate()).files;
    let file;
    try {
      file = await files.read(SETTINGS_FILE);
    } catch (error) {
      if (!isMissing(error)) throw error;
      return (this.loadedSettings = { settings: fallback, hash: null });
    }
    try {
      return (this.loadedSettings = { settings: this.engines.settings.parse(file.content, fallback), hash: file.hash });
    } catch (error) {
      // A broken settings file must not lock anyone out of the settings screen.
      return (this.loadedSettings = {
        settings: fallback,
        hash: file.hash,
        problem: `${SETTINGS_FILE}: ${(error as Error).message} Using defaults until it is fixed.`,
      });
    }
  }

  forgetSettings(): void {
    this.loadedSettings = null;
  }

  /** Reads every task file below the task folder; problems become `warnings`. */
  async tasks(files: readonly string[], settings: Settings, warnings: string[]): Promise<Task[]> {
    const paths = files.filter((file) => within(file, settings.taskRoot) && file.toLowerCase().endsWith(".md"));
    const contents = await (await this.content.locate()).files.readMany(paths);
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
        const task = this.engines.tasks.parse(path, file.content, file.hash);
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

  dispose(): void {
    this.host.dispose();
  }
}

/** Open repositories by id. One window shows one repository, so opening another closes the rest. */
export class WorkspaceRegistry {
  private readonly open = new Map<string, Workspace>();

  get(id: unknown): Workspace {
    const workspace = typeof id === "string" ? this.open.get(id) : undefined;
    if (!workspace) throw new Error("This repository is no longer open.");
    return workspace;
  }

  /** Registers `workspace` under a new id, closing every other one. */
  activate(workspace: Workspace): string {
    for (const [id, other] of this.open) if (other !== workspace) this.close(id);
    for (const [id, other] of this.open) if (other === workspace) this.open.delete(id);
    const id = crypto.randomUUID();
    this.open.set(id, workspace);
    return id;
  }

  /** The open repository, if any. */
  current(): Workspace | null {
    return this.open.values().next().value ?? null;
  }

  close(id: string): void {
    this.open.get(id)?.dispose();
    this.open.delete(id);
  }

  closeAll(): void {
    for (const id of [...this.open.keys()]) this.close(id);
  }
}
