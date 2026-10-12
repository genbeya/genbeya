/**
 * Files, pages, tasks, settings, search and people in the web demo, by the
 * rules of `ContentManager` and with the same engines. Everything
 * lives in the checkout: the demo has no content branch, so moving an area
 * there is refused with a note, and nothing is committed on its own.
 */
import type { ContentManagerContract } from "../../contracts/manager-contracts";
import {
  AGENT_TARGETS,
  type AgentFile,
  type AgentFileWrite,
  type AgentTarget,
  type FileContent,
  type LinkUpdate,
  type PageMove,
  type People,
  type Scope,
  type SearchHit,
  type SearchMatch,
  type SearchResults,
  type Settings,
  type Task,
  type TaskActivity,
  type TaskInput,
  type TaskSearchHit,
  type TaskTemplate,
} from "../../contracts/model";
import { IMAGE_LIMIT, type VersionedFile } from "../../access/files/file-store";
import { isMissing } from "../../access/hosts/host";
import type { AgentEngine } from "../../engines/agent-engine";
import type { LinkEngine } from "../../engines/link-engine";
import type { PeopleEngine } from "../../engines/people-engine";
import { SEARCH_LIMITS, type SearchEngine, type SearchQuery } from "../../engines/search-engine";
import { contentAreaOf, SETTINGS_FILE, type SettingsEngine } from "../../engines/settings-engine";
import type { TaskEngine, TaskVersion } from "../../engines/task-engine";
import type { WikiEngine } from "../../engines/wiki-engine";
import { sha256, toBase64 } from "../../utilities/bytes";
import { referenceIndex } from "../../utilities/references";
import { baseName, relocate, within } from "../../utilities/repository-path";
import type { DemoRegistry, DemoWorkspace } from "./demo-workspace";

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

const ACTIVITY_LIMIT = 100;
const AUTHOR_COMMITS = 5000;
/** Occurrences per line that get a range. */
const RANGES_PER_LINE = 50;

export const NO_CONTENT_BRANCH =
  "In the demo, the wiki, the tasks and the settings stay in the checkout. Download Genbeya to keep them on a content branch.";

/** Equal apart from line endings. */
const sameText = (a: string | null, b: string) => a !== null && a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

export interface DemoContentEngines {
  readonly settings: SettingsEngine;
  readonly tasks: TaskEngine;
  readonly wiki: WikiEngine;
  readonly agents: AgentEngine;
  readonly links: LinkEngine;
  readonly search: SearchEngine;
  readonly people: PeopleEngine;
}

/** The regular expression a query means; git grep's literal, extended and whole-word matching in JavaScript. */
function queryPattern(query: SearchQuery): RegExp {
  let source = query.regex ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (query.wholeWord) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  try {
    return new RegExp(source, `gu${query.caseSensitive ? "" : "i"}`);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${(error as Error).message.replace(/^Invalid regular expression: /, "")}.`, {
      cause: error,
    });
  }
}

export class DemoContentManager implements ContentManagerContract {
  constructor(
    private readonly registry: DemoRegistry,
    private readonly engines: DemoContentEngines,
  ) {}

  private on<T>(id: unknown, operation: (workspace: DemoWorkspace) => Promise<T>): Promise<T> {
    const workspace = this.registry.get(id);
    return workspace.exclusive(() => operation(workspace));
  }

  /** Both scopes are the checkout here; the scope is still checked and echoed. */
  private scope(value: unknown): Scope {
    if (value !== "repo" && value !== "content") throw new Error("Invalid scope.");
    return value;
  }

  read(id: unknown, scope: unknown, path: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => ({ scope: this.scope(scope), ...(await workspace.files.read(workspace.path(path))) }));
  }

  image(id: unknown, scope: unknown, path: unknown): Promise<string> {
    return this.on(id, async (workspace) => {
      this.scope(scope);
      const relative = workspace.path(path);
      const type = IMAGE_TYPES[relative.slice(relative.lastIndexOf(".") + 1).toLowerCase()];
      if (!type) throw new Error(`${relative} is not a supported image.`);
      return `data:${type};base64,${toBase64(await workspace.files.readBytes(relative, IMAGE_LIMIT))}`;
    });
  }

  write(id: unknown, scope: unknown, path: unknown, content: unknown, expectedHash: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const checked = this.scope(scope);
      const relative = workspace.path(path);
      if (typeof content !== "string") throw new Error("Invalid content.");
      const file = await workspace.files.write(relative, content, this.version(expectedHash));
      this.afterEdit(workspace, relative);
      return { scope: checked, ...file };
    });
  }

  remove(id: unknown, scope: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      this.scope(scope);
      const relative = workspace.path(path);
      await workspace.files.remove(relative);
      this.afterEdit(workspace, relative);
    });
  }

  createPage(id: unknown, path: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const page = await this.pagePath(workspace, path);
      return { scope: "content", ...(await workspace.files.write(page, this.engines.wiki.newPage(page), null)) };
    });
  }

  pageLinks(id: unknown, from: unknown, to: unknown): Promise<LinkUpdate[]> {
    return this.on(id, async (workspace) => {
      const { moves } = await this.pageMove(workspace, from, to);
      return (await this.linkRewrites(workspace, moves)).map(({ path, changes }) => ({ path, changes }));
    });
  }

  movePage(id: unknown, from: unknown, to: unknown, options?: unknown): Promise<string> {
    return this.on(id, async (workspace) => {
      const { updateLinks } = this.moveOptions(options);
      const { target, moves } = await this.pageMove(workspace, from, to);
      if (!moves.length) return target;
      const rewrites = updateLinks ? await this.linkRewrites(workspace, moves) : [];
      // Every link update is checked first, so a file changed meanwhile stops the move before it starts.
      for (const rewrite of rewrites) await workspace.files.check(rewrite.path, rewrite.content, rewrite.hash);
      await workspace.files.moveAll(moves);
      for (const rewrite of rewrites)
        await workspace.files.write(relocate(rewrite.path, moves) ?? rewrite.path, rewrite.content, rewrite.hash);
      return target;
    });
  }

  deletePage(id: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const page = await this.pagePath(workspace, path);
      const folder = this.engines.wiki.subpageFolder(page);
      if (workspace.repository.files().some((file) => within(file, folder)))
        throw new Error("This page has subpages. Move or delete them first.");
      await workspace.files.remove(page);
    });
  }

  createTask(id: unknown, input: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { settings } = await workspace.settings();
      const valid = this.engines.tasks.validate(input as TaskInput, settings.statuses);
      const files = workspace.repository.files();
      const existing = await workspace.tasks(files, settings, []);
      const fileNames = new Set(files.filter((file) => this.engines.tasks.isTaskFile(file, settings.taskRoot)).map(baseName));
      const taskId = this.engines.tasks.nextId(
        settings.taskPrefix,
        existing.map((task) => task.id),
        (candidate) => fileNames.has(`${candidate}.md`),
      );
      const epic = this.engines.tasks.existingSpelling(valid.epic, files, settings.taskRoot);
      const path = workspace.path(this.engines.tasks.pathOf(settings.taskRoot, epic, taskId));
      const file = await workspace.files.write(path, this.engines.tasks.serializeNew(taskId, valid), null);
      return this.engines.tasks.parse(path, file.content, file.hash, settings.taskRoot);
    });
  }

  updateTask(id: unknown, path: unknown, input: unknown, expectedHash: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const valid = this.engines.tasks.validate(input as TaskInput, settings.statuses);
      const original = await workspace.files.read(relative);
      if (original.hash !== expectedHash) throw new Error("This task changed on disk. Reopen it to see the latest version.");
      const task = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot);
      // Another epic is another folder; the file keeps its name.
      const epic = this.engines.tasks.existingSpelling(valid.epic, workspace.repository.files(), settings.taskRoot);
      const target =
        epic === task.epic ? relative : workspace.path(this.engines.tasks.pathOf(settings.taskRoot, epic, baseName(relative).slice(0, -3)));
      const content = this.engines.tasks.serializeUpdate(original.content, valid);
      if (target !== relative) {
        await workspace.files.check(relative, content, original.hash);
        await workspace.files.moveAll([[relative, target]]);
      }
      const file = await workspace.files.write(target, content, original.hash);
      return this.engines.tasks.parse(target, file.content, file.hash, settings.taskRoot);
    });
  }

  deleteTask(id: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const { relative } = await this.taskPath(workspace, path);
      await workspace.files.remove(relative);
    });
  }

  taskTemplate(id: unknown, type: unknown): Promise<TaskTemplate | null> {
    return this.on(id, async (workspace) => {
      const path = await this.templatePath(workspace, type);
      if ((await workspace.files.kind(path)) !== "file") return null;
      return this.engines.tasks.parseTemplate((await workspace.files.read(path)).content);
    });
  }

  ensureTaskTemplate(id: unknown, type: unknown): Promise<string> {
    return this.on(id, async (workspace) => {
      const path = await this.templatePath(workspace, type);
      if (!(await workspace.files.kind(path))) await workspace.files.write(path, this.engines.tasks.newTemplate(type as string), null);
      return path;
    });
  }

  taskActivity(id: unknown, path: unknown): Promise<readonly TaskActivity[]> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const current = await workspace.files.read(relative);
      const committed = this.lastCommitted(workspace, relative, settings.taskRoot);
      const revisions = committed ? workspace.repository.fileHistory(committed.path, ACTIVITY_LIMIT) : [];
      const activity: TaskActivity[] = revisions.map((revision) => ({
        commit: revision.hash,
        author: revision.author,
        date: revision.date,
        subject: revision.subject,
        changes: this.engines.tasks.changesBetween(
          revision.oldPath === null ? null : { path: revision.oldPath, content: revision.before },
          { path: revision.path, content: revision.after },
          settings.taskRoot,
        ),
      }));
      const now = { path: relative, content: current.content };
      if (!committed || committed.path !== relative || !sameText(committed.content, current.content))
        activity.unshift({
          commit: null,
          author: workspace.repository.identity.name,
          date: null,
          subject: "",
          changes: this.engines.tasks.changesBetween(committed, now, settings.taskRoot),
        });
      return activity;
    });
  }

  commentAuthor(id: unknown): Promise<string> {
    return this.on(id, async (workspace) => this.author(workspace));
  }

  addComment(id: unknown, path: unknown, text: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const comment = this.engines.tasks.validComment(text);
      const original = await workspace.files.read(relative);
      this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot);
      const content = this.engines.tasks.addComment(original.content, this.author(workspace), new Date(), comment);
      const file = await workspace.files.write(relative, content, original.hash);
      return this.engines.tasks.parse(relative, file.content, file.hash, settings.taskRoot);
    });
  }

  editComment(id: unknown, path: unknown, index: unknown, text: unknown, expectedHash: unknown): Promise<Task> {
    return this.changeComment(id, path, index, expectedHash, (content, at) =>
      this.engines.tasks.editComment(content, at, this.engines.tasks.validComment(text)),
    );
  }

  deleteComment(id: unknown, path: unknown, index: unknown, expectedHash: unknown): Promise<Task> {
    return this.changeComment(id, path, index, expectedHash, (content, at) => this.engines.tasks.removeComment(content, at));
  }

  /** Changes comment `index` of the version `expectedHash` of a task, if the user wrote it. */
  private changeComment(
    id: unknown,
    path: unknown,
    index: unknown,
    expectedHash: unknown,
    change: (content: string, index: number) => string,
  ): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      if (!Number.isInteger(index) || (index as number) < 0) throw new Error("Invalid comment.");
      const original = await workspace.files.read(relative);
      if (original.hash !== expectedHash) throw new Error("This task changed on disk. Reopen it to see the latest version.");
      const task = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot);
      const comment = task.comments[index as number];
      if (!comment) throw new Error("This comment no longer exists. Reopen the task to see the latest version.");
      if (comment.author !== this.author(workspace)) throw new Error("You can only change your own comments.");
      const file = await workspace.files.write(relative, change(original.content, index as number), original.hash);
      return this.engines.tasks.parse(relative, file.content, file.hash, settings.taskRoot);
    });
  }

  private author(workspace: DemoWorkspace): string {
    return this.engines.tasks.commentAuthor(workspace.repository.identity.name);
  }

  /** The task file as last committed: at its path, or, for a task moved to another epic since, the committed file with its name. */
  private lastCommitted(workspace: DemoWorkspace, relative: string, taskRoot: string): TaskVersion | null {
    const head = workspace.repository.headTree();
    const content = head.get(relative);
    if (content !== undefined) return { path: relative, content };
    const name = baseName(relative);
    const moved = [...head.keys()].find((file) => baseName(file) === name && this.engines.tasks.isTaskFile(file, taskRoot));
    return moved ? { path: moved, content: head.get(moved)! } : null;
  }

  saveSettings(id: unknown, settings: unknown, expectedHash: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const version = this.version(expectedHash);
      const previous = version === null ? null : (await workspace.files.read(SETTINGS_FILE)).content;
      await workspace.files.write(SETTINGS_FILE, this.engines.settings.serialize(settings as Settings, previous, false), version);
      workspace.forgetSettings();
    });
  }

  async setStorage(): Promise<void> {
    throw new Error(NO_CONTENT_BRANCH);
  }

  async syncContent(): Promise<void> {
    throw new Error(NO_CONTENT_BRANCH);
  }

  agentFiles(id: unknown, targets: unknown): Promise<AgentFile[]> {
    return this.on(id, async (workspace) => {
      const rules = workspace.repository.ignoreRules();
      return (await this.planAgentFiles(workspace, targets)).map(({ file, existing }) => ({
        target: file.target,
        path: file.path,
        text: file.text,
        state: this.engines.agents.stateOf(file, existing?.content ?? null),
        ignored: !workspace.repository.index.has(file.path) && rules.ignores(file.path),
      }));
    });
  }

  addAgentFiles(id: unknown, targets: unknown): Promise<AgentFileWrite[]> {
    return this.on(id, async (workspace) => {
      const planned = (await this.planAgentFiles(workspace, targets)).filter(({ file }) => (targets as unknown[]).includes(file.target));
      if (!planned.length) throw new Error("Choose the files to add.");
      const merged = planned.map(({ file, existing }) => ({
        file,
        existing,
        content: this.engines.agents.merge(file, existing?.content ?? null),
      }));
      const written: AgentFileWrite[] = [];
      for (const { file, existing, content } of merged) {
        const result = content === existing?.content ? "unchanged" : existing ? "updated" : "created";
        if (result !== "unchanged") await workspace.files.write(file.path, content, existing?.hash ?? null);
        written.push({ path: file.path, result });
      }
      return written;
    });
  }

  private async planAgentFiles(workspace: DemoWorkspace, targets: unknown) {
    if (!Array.isArray(targets) || targets.some((target) => !AGENT_TARGETS.includes(target as AgentTarget)))
      throw new Error("Unknown agent file.");
    const { settings } = await workspace.settings();
    return Promise.all(
      this.engines.agents.files(settings, targets as AgentTarget[]).map(async (file) => ({
        file,
        existing: await workspace.files.read(file.path).catch((error: unknown) => {
          if (isMissing(error)) return null;
          throw error;
        }),
      })),
    );
  }

  /** Finds text in the files of the working tree that are tracked, or untracked and not ignored, as `git grep --untracked` does. */
  search(id: unknown, text: unknown, options?: unknown): Promise<SearchResults> {
    const query = this.engines.search.validate(text, options);
    const pattern = queryPattern(query);
    return this.on(id, async (workspace) => {
      const { settings } = await workspace.settings();
      const { search, wiki, tasks: taskEngine } = this.engines;
      let truncated = false;
      const results: { wiki: SearchHit[]; tasks: SearchHit[]; code: SearchHit[] } = { wiki: [], tasks: [], code: [] };
      for (const path of workspace.repository.files()) {
        const content = workspace.repository.worktree.get(path)!;
        if (content.includes("\0")) continue;
        const matches = this.matches(content, pattern);
        if (!matches.length) continue;
        const area = search.areaOf(path, settings);
        if (results[area].length === SEARCH_LIMITS.filesPerArea) {
          truncated = true;
          continue;
        }
        if (matches.length > SEARCH_LIMITS.matchesPerFile) truncated = true;
        results[area].push({
          path,
          scope: contentAreaOf(path, settings) ? "content" : "repo",
          title: area === "wiki" ? wiki.titleOf(path) : baseName(path),
          matches: matches.slice(0, SEARCH_LIMITS.matchesPerFile),
        });
      }
      const taskHits: TaskSearchHit[] = results.tasks.map((hit) => {
        let task: Task | null = null;
        try {
          const content = workspace.repository.worktree.get(hit.path)!;
          task = taskEngine.parse(hit.path, content, sha256(content), settings.taskRoot);
        } catch {
          /* Listed under its file name. */
        }
        const taskId = task?.id ?? baseName(hit.path).replace(/\.md$/i, "");
        return { ...hit, id: taskId, title: task?.title ?? taskId, status: task?.status ?? "" };
      });
      return { wiki: results.wiki, tasks: taskHits, code: results.code, truncated };
    });
  }

  /** The matching lines of a file with the lines around them, shortened as they are shown; one more than shown tells that a file has more. */
  private matches(content: string, pattern: RegExp): SearchMatch[] {
    const lines = content.split("\n").map((line) => line.replace(/\r$/, ""));
    if (lines.at(-1) === "") lines.pop();
    const found: SearchMatch[] = [];
    const excerpt = (line: string | undefined) => (line === undefined ? null : this.engines.search.excerpt(line, []).text);
    for (let i = 0; i < lines.length && found.length <= SEARCH_LIMITS.matchesPerFile; i++) {
      const ranges = [...lines[i]!.matchAll(pattern)]
        .filter((match) => match[0].length)
        .slice(0, RANGES_PER_LINE)
        .map((match) => ({ start: match.index, end: match.index + match[0].length }));
      if (!ranges.length) continue;
      found.push({
        line: i + 1,
        ...this.engines.search.excerpt(lines[i]!, ranges),
        before: excerpt(lines[i - 1]),
        after: excerpt(lines[i + 1]),
      });
    }
    return found;
  }

  people(id: unknown): Promise<People> {
    return this.on(id, async (workspace) => {
      const { settings } = await workspace.settings(true);
      const tasks = await workspace.tasks(workspace.repository.files(), settings, []);
      const people = this.engines.people.merge({
        configured: settings.people,
        authors: workspace.repository.authors(AUTHOR_COMMITS),
        assignees: tasks.map((task) => task.assignee),
        commenters: tasks.flatMap((task) => task.comments.map((comment) => comment.author)),
      });
      return { people, me: this.engines.people.me(people, workspace.repository.identity) };
    });
  }

  private version(value: unknown): string | null {
    if (value !== null && typeof value !== "string") throw new Error("Invalid file version.");
    return value;
  }

  /** The settings are read again after edits that may have changed them. */
  private afterEdit(workspace: DemoWorkspace, path: string) {
    if (path === SETTINGS_FILE) workspace.forgetSettings();
  }

  private moveOptions(value: unknown): PageMove {
    if (value === undefined) return {};
    const options = value as PageMove | null;
    if (typeof options !== "object" || options === null || !["undefined", "boolean"].includes(typeof options.updateLinks))
      throw new Error("Invalid move options.");
    return options;
  }

  /** The renames that move a page, and its subpages when it has them. */
  private async pageMove(workspace: DemoWorkspace, from: unknown, to: unknown) {
    const source = await this.pagePath(workspace, from);
    const target = await this.pagePath(workspace, to);
    const hasSubpages = (await workspace.files.kind(this.engines.wiki.subpageFolder(source))) === "dir";
    const moves = this.engines.wiki.planMove(source, target, hasSubpages);
    for (const path of moves.flat()) workspace.path(path);
    return { source, target, moves };
  }

  /** The Markdown files whose links `moves` would break, rewritten, with the versions they were read at. */
  private async linkRewrites(workspace: DemoWorkspace, moves: readonly [string, string][]) {
    if (!moves.length) return [];
    const { settings } = await workspace.settings();
    const files = workspace.repository.files();
    const documents = (await workspace.files.readMany(files.filter((file) => file.toLowerCase().endsWith(".md")))).filter(
      (file): file is VersionedFile => !!file && !(file instanceof Error),
    );
    const tasks = await workspace.tasks(files, settings, []);
    const index = (list: readonly string[]) =>
      referenceIndex({ wikiRoot: settings.wikiRoot, pages: this.engines.wiki.pages(list, settings), tasks, files: list });
    const context = { moves, before: index(files), after: index(files.map((file) => relocate(file, moves) ?? file)) };
    const versions = new Map(documents.map((file) => [file.path, file]));
    return this.engines.links.rewrite(documents, context).map((rewrite) => ({ ...rewrite, hash: versions.get(rewrite.path)!.hash }));
  }

  private async pagePath(workspace: DemoWorkspace, value: unknown): Promise<string> {
    const relative = workspace.path(value);
    const { settings } = await workspace.settings();
    if (!this.engines.wiki.isPage(relative, settings)) throw new Error(`Pages are Markdown files inside ${settings.wikiRoot}/.`);
    return relative;
  }

  private async taskPath(workspace: DemoWorkspace, value: unknown): Promise<{ relative: string; settings: Settings }> {
    const relative = workspace.path(value);
    const { settings } = await workspace.settings();
    if (!this.engines.tasks.isTaskFile(relative, settings.taskRoot))
      throw new Error(`Tasks are Markdown files inside ${settings.taskRoot}/.`);
    return { relative, settings };
  }

  private async templatePath(workspace: DemoWorkspace, type: unknown): Promise<string> {
    const { settings } = await workspace.settings();
    return workspace.path(this.engines.tasks.templatePath(settings.taskRoot, type));
  }
}
