/** Everything that edits files: repository files, wiki pages, tasks, settings and the files that teach coding agents to use them. */
import type { ContentManagerContract } from "../contracts/manager-contracts";
import {
  AGENT_TARGETS,
  type AgentFile,
  type AgentFileWrite,
  type AgentTarget,
  type FileContent,
  type Scope,
  type Settings,
  type StorageMode,
  type Task,
  type TaskInput,
} from "../contracts/model";
import { IMAGE_LIMIT } from "../access/files/file-store";
import { isMissing } from "../access/hosts/host";
import type { AgentEngine } from "../engines/agent-engine";
import { SETTINGS_FILE, type SettingsEngine } from "../engines/settings-engine";
import type { TaskEngine } from "../engines/task-engine";
import type { WikiEngine } from "../engines/wiki-engine";
import { toBase64 } from "../utilities/bytes";
import { baseName, within } from "../utilities/repository-path";
import type { Workspace, WorkspaceRegistry } from "./workspace";

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

const STORAGE_MODES: readonly StorageMode[] = ["worktree", "branch"];

export class ContentManager implements ContentManagerContract {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly engines: {
      readonly settings: SettingsEngine;
      readonly tasks: TaskEngine;
      readonly wiki: WikiEngine;
      readonly agents: AgentEngine;
    },
  ) {}

  /** Runs an operation on the workspace named by `id`, after its earlier operations. */
  private on<T>(id: unknown, operation: (workspace: Workspace) => Promise<T>): Promise<T> {
    const workspace = this.registry.get(id);
    return workspace.exclusive(() => operation(workspace));
  }

  read(id: unknown, scope: unknown, path: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const file = await (await workspace.files(scope as Scope)).read(workspace.path(path));
      return { scope: scope as Scope, ...file };
    });
  }

  image(id: unknown, scope: unknown, path: unknown): Promise<string> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const type = IMAGE_TYPES[relative.slice(relative.lastIndexOf(".") + 1).toLowerCase()];
      if (!type) throw new Error(`${relative} is not a supported image.`);
      const data = await (await workspace.files(scope as Scope)).readBytes(relative, IMAGE_LIMIT);
      return `data:${type};base64,${toBase64(data)}`;
    });
  }

  write(id: unknown, scope: unknown, path: unknown, content: unknown, expectedHash: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      if (typeof content !== "string") throw new Error("Invalid content.");
      const file = await (await workspace.files(scope as Scope)).write(relative, content, this.version(expectedHash));
      await this.afterEdit(workspace, scope as Scope, relative, `Edit ${relative}`);
      return { scope: scope as Scope, ...file };
    });
  }

  remove(id: unknown, scope: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      await (await workspace.files(scope as Scope)).remove(relative);
      await this.afterEdit(workspace, scope as Scope, relative, `Delete ${relative}`);
    });
  }

  createPage(id: unknown, path: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const page = await this.pagePath(workspace, path);
      const file = await (await workspace.content.locate()).files.write(page, this.engines.wiki.newPage(page), null);
      await workspace.content.record([page], `Create page ${this.engines.wiki.titleOf(page)}`);
      return { scope: "content", ...file };
    });
  }

  movePage(id: unknown, from: unknown, to: unknown): Promise<string> {
    return this.on(id, async (workspace) => {
      const source = await this.pagePath(workspace, from);
      const target = await this.pagePath(workspace, to);
      const { files } = await workspace.content.locate();
      const hasSubpages = (await files.kind(this.engines.wiki.subpageFolder(source))) === "dir";
      const moves = this.engines.wiki.planMove(source, target, hasSubpages);
      if (!moves.length) return target;
      // Subpage folders are derived names: on Windows the page `docs/GIT~1.md` has the folder `docs/GIT~1`.
      for (const path of moves.flat()) workspace.path(path);
      await files.moveAll(moves);
      await workspace.content.record(moves.flat(), `Move page ${this.engines.wiki.titleOf(source)} to ${target}`);
      return target;
    });
  }

  deletePage(id: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const page = await this.pagePath(workspace, path);
      const folder = this.engines.wiki.subpageFolder(page);
      if ((await workspace.content.files()).some((file) => within(file, folder)))
        throw new Error("This page has subpages. Move or delete them first.");
      await (await workspace.content.locate()).files.remove(page);
      await workspace.content.record([page], `Delete page ${this.engines.wiki.titleOf(page)}`);
    });
  }

  createTask(id: unknown, input: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { settings } = await workspace.settings();
      const valid = this.engines.tasks.validate(input as TaskInput, settings.statuses);
      const files = await workspace.content.files();
      const existing = await workspace.tasks(files, settings, []);
      // A free ID may still name a file in some epic, e.g. a task renamed on another branch.
      const fileNames = new Set(files.filter((file) => within(file, settings.taskRoot)).map(baseName));
      const taskId = this.engines.tasks.nextId(
        settings.taskPrefix,
        existing.map((task) => task.id),
        (candidate) => fileNames.has(`${candidate}.md`),
      );
      const epic = this.engines.tasks.existingSpelling(valid.epic, files, settings.taskRoot);
      const path = workspace.path(this.engines.tasks.pathOf(settings.taskRoot, epic, taskId));
      const file = await (await workspace.content.locate()).files.write(path, this.engines.tasks.serializeNew(taskId, valid), null);
      await workspace.content.record([path], `Create ${taskId}: ${valid.title}`);
      return this.engines.tasks.parse(path, file.content, file.hash, settings.taskRoot);
    });
  }

  updateTask(id: unknown, path: unknown, input: unknown, expectedHash: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const valid = this.engines.tasks.validate(input as TaskInput, settings.statuses);
      const { files } = await workspace.content.locate();
      const original = await files.read(relative);
      if (original.hash !== expectedHash) throw new Error("This task changed on disk. Reopen it to see the latest version.");
      const task = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot);
      // Another epic is another folder; the file keeps its name.
      const epic = this.engines.tasks.existingSpelling(valid.epic, await workspace.content.files(), settings.taskRoot);
      const target =
        epic === task.epic ? relative : workspace.path(this.engines.tasks.pathOf(settings.taskRoot, epic, baseName(relative).slice(0, -3)));
      if (target !== relative) await files.moveAll([[relative, target]]);
      const file = await files.write(target, this.engines.tasks.serializeUpdate(original.content, valid), original.hash);
      await workspace.content.record([...new Set([relative, target])], `Update ${task.id}: ${valid.title}`);
      return this.engines.tasks.parse(target, file.content, file.hash, settings.taskRoot);
    });
  }

  deleteTask(id: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const { files } = await workspace.content.locate();
      const original = await files.read(relative);
      let taskId = baseName(relative).slice(0, -3);
      try {
        taskId = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot).id;
      } catch {
        /* Unreadable task files can be deleted too. */
      }
      await files.remove(relative);
      await workspace.content.record([relative], `Delete ${taskId}`);
    });
  }

  saveSettings(id: unknown, settings: unknown, expectedHash: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const { files } = await workspace.content.locate();
      const version = this.version(expectedHash);
      const previous = version === null ? null : (await files.read(SETTINGS_FILE)).content;
      await files.write(SETTINGS_FILE, this.engines.settings.serialize(settings as Settings, previous, workspace.windows), version);
      workspace.forgetSettings();
      await workspace.content.record([SETTINGS_FILE], "Update GitDesk settings");
    });
  }

  setStorage(id: unknown, mode: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      if (!STORAGE_MODES.includes(mode as StorageMode)) throw new Error("Invalid storage mode.");
      const { settings } = await workspace.settings();
      await workspace.content.setMode(mode as StorageMode, [settings.wikiRoot, settings.taskRoot, SETTINGS_FILE]);
      workspace.forgetSettings();
    });
  }

  syncContent(id: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      await workspace.content.sync();
      workspace.forgetSettings();
    });
  }

  agentFiles(id: unknown, targets: unknown): Promise<AgentFile[]> {
    return this.on(id, async (workspace) => {
      const planned = await this.planAgentFiles(workspace, targets);
      const ignored = await workspace.repository.ignored(planned.map(({ file }) => file.path));
      return planned.map(({ file, existing }) => ({
        target: file.target,
        path: file.path,
        text: file.text,
        state: this.engines.agents.stateOf(file, existing?.content ?? null),
        ignored: ignored.has(file.path),
      }));
    });
  }

  addAgentFiles(id: unknown, targets: unknown): Promise<AgentFileWrite[]> {
    return this.on(id, async (workspace) => {
      const planned = (await this.planAgentFiles(workspace, targets)).filter(({ file }) => (targets as unknown[]).includes(file.target));
      if (!planned.length) throw new Error("Choose the files to add.");
      // Every file is merged before the first is written, so broken markers leave all of them alone.
      const merged = planned.map(({ file, existing }) => ({
        file,
        existing,
        content: this.engines.agents.merge(file, existing?.content ?? null),
      }));
      const written: AgentFileWrite[] = [];
      for (const { file, existing, content } of merged) {
        const result = content === existing?.content ? "unchanged" : existing ? "updated" : "created";
        if (result !== "unchanged") await workspace.checkout.write(file.path, content, existing?.hash ?? null);
        written.push({ path: file.path, result });
      }
      return written;
    });
  }

  /** Every agent file with what the checkout has of it; they are code, so they never live on the content branch. */
  private async planAgentFiles(workspace: Workspace, targets: unknown) {
    if (!Array.isArray(targets) || targets.some((target) => !AGENT_TARGETS.includes(target as AgentTarget)))
      throw new Error("Unknown agent file.");
    const { settings } = await workspace.settings();
    return Promise.all(
      this.engines.agents.files(settings, targets as AgentTarget[]).map(async (file) => ({
        file,
        existing: await workspace.checkout.read(file.path).catch((error: unknown) => {
          if (isMissing(error)) return null;
          throw error;
        }),
      })),
    );
  }

  private version(value: unknown): string | null {
    if (value !== null && typeof value !== "string") throw new Error("Invalid file version.");
    return value;
  }

  /** Content edits are committed on a dedicated branch; settings edits are re-read. */
  private async afterEdit(workspace: Workspace, scope: Scope, path: string, message: string) {
    if (scope === "content" || path === SETTINGS_FILE) workspace.forgetSettings();
    if (scope === "content") await workspace.content.record([path], message);
  }

  private async pagePath(workspace: Workspace, value: unknown): Promise<string> {
    const relative = workspace.path(value);
    const { settings } = await workspace.settings();
    if (!this.engines.wiki.isPage(relative, settings)) throw new Error(`Pages are Markdown files inside ${settings.wikiRoot}/.`);
    return relative;
  }

  private async taskPath(workspace: Workspace, value: unknown): Promise<{ relative: string; settings: Settings }> {
    const relative = workspace.path(value);
    const { settings } = await workspace.settings();
    if (!within(relative, settings.taskRoot) || !relative.endsWith(".md"))
      throw new Error(`Tasks are Markdown files inside ${settings.taskRoot}/.`);
    return { relative, settings };
  }
}
