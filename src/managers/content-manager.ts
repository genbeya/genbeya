/** Everything that edits files: repository files, wiki pages, tasks, settings and the files that teach coding agents to use them. */
import type { ContentManagerContract } from "../contracts/manager-contracts";
import {
  AGENT_TARGETS,
  CONTENT_AREAS,
  STORAGE_MODES,
  type AgentFile,
  type AgentFileWrite,
  type AgentTarget,
  type ContentArea,
  type FileContent,
  type LinkUpdate,
  type PageMove,
  type People,
  type PullRequest,
  type Scope,
  type SearchResults,
  type Settings,
  type StorageMode,
  type Task,
  type TaskActivity,
  type TaskInput,
  type TaskTemplate,
} from "../contracts/model";
import type { ContentLocation } from "../access/content/content-store";
import { IMAGE_LIMIT, type VersionedFile } from "../access/files/file-store";
import { commitAuthors, commitIdentity, type AuthorCount } from "../access/git/authors";
import { isMissing } from "../access/hosts/host";
import type { AgentEngine } from "../engines/agent-engine";
import type { LinkEngine, LinkRewrite } from "../engines/link-engine";
import type { PeopleEngine } from "../engines/people-engine";
import type { PullEngine } from "../engines/pull-engine";
import type { SearchEngine } from "../engines/search-engine";
import { SETTINGS_FILE, type SettingsEngine } from "../engines/settings-engine";
import type { TaskEngine, TaskVersion } from "../engines/task-engine";
import type { WikiEngine } from "../engines/wiki-engine";
import { sha256 } from "../utilities/bytes";
import { imageType, imageUrl } from "../utilities/image-types";
import { referenceIndex } from "../utilities/references";
import { baseName, relocate, within } from "../utilities/repository-path";
import { searchContent } from "./content-search";
import type { Workspace, WorkspaceRegistry } from "./workspace";

/** Commits a task's activity lists at most. */
const ACTIVITY_LIMIT = 100;
/** Larger task files list their commits without what changed, so the history stays small. */
const ACTIVITY_CONTENT_LIMIT = 256 * 1024;

/** Recent commits whose authors count as the repository's people; enough for years of a busy team, quick over SSH. */
const AUTHOR_COMMITS = 5000;

/** Equal apart from line endings, which Git may convert on checkout. */
const sameText = (a: string | null, b: string) => a !== null && a.replace(/\r\n/g, "\n") === b.replace(/\r\n/g, "\n");

export class ContentManager implements ContentManagerContract {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly engines: {
      readonly settings: SettingsEngine;
      readonly tasks: TaskEngine;
      readonly pulls: PullEngine;
      readonly wiki: WikiEngine;
      readonly agents: AgentEngine;
      readonly links: LinkEngine;
      readonly search: SearchEngine;
      readonly people: PeopleEngine;
    },
  ) {}

  /** Commit authors per open repository, read again only when HEAD moves. */
  private readonly authors = new WeakMap<Workspace, { readonly head: string | null; readonly authors: Promise<AuthorCount[]> }>();

  /** Runs an operation on the workspace named by `id`, after its earlier operations. */
  private on<T>(id: unknown, operation: (workspace: Workspace) => Promise<T>): Promise<T> {
    const workspace = this.registry.get(id);
    return workspace.exclusive(() => operation(workspace));
  }

  read(id: unknown, scope: unknown, path: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const file = await (await workspace.files(scope as Scope, relative)).read(relative);
      return { scope: scope as Scope, ...file };
    });
  }

  image(id: unknown, scope: unknown, path: unknown): Promise<string> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const type = imageType(relative);
      if (!type) throw new Error(`${relative} is not a supported image.`);
      const data = await (await workspace.files(scope as Scope, relative)).readBytes(relative, IMAGE_LIMIT);
      return imageUrl(type, data);
    });
  }

  write(id: unknown, scope: unknown, path: unknown, content: unknown, expectedHash: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      if (typeof content !== "string") throw new Error("Invalid content.");
      const file = await (await workspace.files(scope as Scope, relative)).write(relative, content, this.version(expectedHash));
      await this.afterEdit(workspace, scope as Scope, relative, `Edit ${relative}`);
      return { scope: scope as Scope, ...file };
    });
  }

  remove(id: unknown, scope: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      await (await workspace.files(scope as Scope, relative)).remove(relative);
      await this.afterEdit(workspace, scope as Scope, relative, `Delete ${relative}`);
    });
  }

  createPage(id: unknown, path: unknown): Promise<FileContent> {
    return this.on(id, async (workspace) => {
      const page = await this.pagePath(workspace, path);
      const file = await (await workspace.content.locate("wiki")).files.write(page, this.engines.wiki.newPage(page), null);
      await workspace.content.record("wiki", [page], `Create page ${this.engines.wiki.titleOf(page)}`);
      return { scope: "content", ...file };
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
      const { source, target, moves } = await this.pageMove(workspace, from, to);
      if (!moves.length) return target;
      const rewrites = updateLinks ? await this.linkRewrites(workspace, moves) : [];
      const files = { wiki: (await workspace.content.locate("wiki")).files, tasks: (await workspace.content.locate("tasks")).files };
      // Every link update is checked first, so a file too large or changed meanwhile stops the move before it starts.
      for (const rewrite of rewrites) await files[rewrite.area].check(rewrite.path, rewrite.content, rewrite.hash);
      await files.wiki.moveAll(moves);
      // One commit per location: the wiki's, and the tasks' when they live elsewhere.
      const updated: Record<"wiki" | "tasks", string[]> = { wiki: [], tasks: [] };
      const message = `Move page ${this.engines.wiki.titleOf(source)} to ${target}`;
      const describe = (paths: readonly string[]) => (paths.length ? `${message}\n\nUpdate links in ${paths.join(", ")}.` : message);
      const record = async () => {
        await workspace.content.record("wiki", [...moves.flat(), ...updated.wiki], describe(updated.wiki));
        if (updated.tasks.length) await workspace.content.record("tasks", updated.tasks, describe(updated.tasks));
      };
      const written: (typeof rewrites)[number][] = [];
      try {
        for (const rewrite of rewrites) {
          const path = relocate(rewrite.path, moves) ?? rewrite.path;
          await files[rewrite.area].write(path, rewrite.content, rewrite.hash);
          written.unshift(rewrite);
          updated[rewrite.area].push(path);
        }
      } catch (error) {
        // A write can still fail, as on a file another program holds open: the move is undone.
        try {
          for (const rewrite of written)
            await files[rewrite.area].write(relocate(rewrite.path, moves) ?? rewrite.path, rewrite.original, sha256(rewrite.content));
          await files.wiki.moveAll(moves.map(([from, to]) => [to, from] as const).reverse());
        } catch (undo) {
          // What could not be undone is committed like any other edit.
          await record();
          throw new Error(`${(error as Error).message} The page could not be moved back either: ${(undo as Error).message}`, {
            cause: undo,
          });
        }
        throw error;
      }
      await record();
      const { settings } = await workspace.settings();
      for (const [from] of moves) await files.wiki.removeEmptyFolders(from, settings.wikiRoot);
      return target;
    });
  }

  deletePage(id: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const page = await this.pagePath(workspace, path);
      const folder = this.engines.wiki.subpageFolder(page);
      if ((await workspace.content.files("wiki")).some((file) => within(file, folder)))
        throw new Error("This page has subpages. Move or delete them first.");
      const { files } = await workspace.content.locate("wiki");
      await files.remove(page);
      await files.removeEmptyFolders(page, (await workspace.settings()).settings.wikiRoot);
      await workspace.content.record("wiki", [page], `Delete page ${this.engines.wiki.titleOf(page)}`);
    });
  }

  createTask(id: unknown, input: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { settings } = await workspace.settings();
      const valid = this.engines.tasks.validate(input as TaskInput, settings.statuses);
      const files = await workspace.content.files("tasks");
      const existing = await workspace.tasks(files, settings, []);
      // A free ID may still name a file in some epic, e.g. a task renamed on another branch.
      const fileNames = new Set(files.filter((file) => this.engines.tasks.isTaskFile(file, settings.taskRoot)).map(baseName));
      const taskId = this.engines.tasks.nextId(
        settings.taskPrefix,
        existing.map((task) => task.id),
        (candidate) => fileNames.has(`${candidate}.md`),
      );
      const epic = this.engines.tasks.existingSpelling(valid.epic, files, settings.taskRoot);
      const path = workspace.path(this.engines.tasks.pathOf(settings.taskRoot, epic, taskId));
      const file = await (await workspace.content.locate("tasks")).files.write(path, this.engines.tasks.serializeNew(taskId, valid), null);
      await workspace.content.record("tasks", [path], `Create ${taskId}: ${valid.title}`);
      return this.engines.tasks.parse(path, file.content, file.hash, settings.taskRoot);
    });
  }

  updateTask(id: unknown, path: unknown, input: unknown, expectedHash: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const valid = this.engines.tasks.validate(input as TaskInput, settings.statuses);
      const { files } = await workspace.content.locate("tasks");
      const original = await files.read(relative);
      if (original.hash !== expectedHash) throw new Error("This task changed on disk. Reopen it to see the latest version.");
      const task = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot);
      // Another epic is another folder; the file keeps its name.
      const epic = this.engines.tasks.existingSpelling(valid.epic, await workspace.content.files("tasks"), settings.taskRoot);
      const target =
        epic === task.epic ? relative : workspace.path(this.engines.tasks.pathOf(settings.taskRoot, epic, baseName(relative).slice(0, -3)));
      const content = this.engines.tasks.serializeUpdate(original.content, valid);
      if (target !== relative) {
        await files.check(relative, content, original.hash);
        await files.moveAll([[relative, target]]);
        await files.removeEmptyFolders(relative, settings.taskRoot);
      }
      const file = await files.write(target, content, original.hash);
      await workspace.content.record("tasks", [...new Set([relative, target])], `Update ${task.id}: ${valid.title}`);
      return this.engines.tasks.parse(target, file.content, file.hash, settings.taskRoot);
    });
  }

  deleteTask(id: unknown, path: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const { files } = await workspace.content.locate("tasks");
      const original = await files.read(relative);
      let taskId = baseName(relative).slice(0, -3);
      try {
        taskId = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot).id;
      } catch {
        /* Unreadable task files can be deleted too. */
      }
      await files.remove(relative);
      await files.removeEmptyFolders(relative, settings.taskRoot);
      await workspace.content.record("tasks", [relative], `Delete ${taskId}`);
    });
  }

  taskTemplate(id: unknown, type: unknown): Promise<TaskTemplate | null> {
    return this.on(id, async (workspace) => {
      const path = await this.templatePath(workspace, type);
      const { files } = await workspace.content.locate("tasks");
      if ((await files.kind(path)) !== "file") return null;
      return this.engines.tasks.parseTemplate((await files.read(path)).content);
    });
  }

  ensureTaskTemplate(id: unknown, type: unknown): Promise<string> {
    return this.on(id, async (workspace) => {
      const path = await this.templatePath(workspace, type);
      const { files } = await workspace.content.locate("tasks");
      if (!(await files.kind(path))) {
        await files.write(path, this.engines.tasks.newTemplate(type as string), null);
        await workspace.content.record("tasks", [path], `Create the ${type as string} task template`);
      }
      return path;
    });
  }

  taskActivity(id: unknown, path: unknown): Promise<readonly TaskActivity[]> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const current = await (await workspace.content.locate("tasks")).files.read(relative);
      const committed = await this.lastCommitted(workspace, relative, settings.taskRoot);
      const contents = current.content.length <= ACTIVITY_CONTENT_LIMIT;
      const revisions = committed ? await workspace.content.history("tasks", committed.path, ACTIVITY_LIMIT, contents) : [];
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
          author: (await workspace.content.author()) ?? "",
          date: null,
          subject: "",
          changes: this.engines.tasks.changesBetween(committed, now, settings.taskRoot),
        });
      return activity;
    });
  }

  createPull(id: unknown, input: unknown): Promise<PullRequest> {
    return this.on(id, async (workspace) => {
      const { settings } = await workspace.settings();
      const valid = this.engines.pulls.validate(input);
      const files = await workspace.content.files("pulls");
      const existing = await workspace.pulls(files, settings, []);
      const pullId = this.engines.pulls.nextId(
        settings.pullPrefix,
        existing.map((pull) => pull.id),
        (candidate) => files.includes(this.engines.pulls.pathOf(settings.pullRoot, candidate)),
      );
      const path = workspace.path(this.engines.pulls.pathOf(settings.pullRoot, pullId));
      const content = this.engines.pulls.serializeNew(pullId, valid, await this.author(workspace));
      const file = await (await workspace.content.locate("pulls")).files.write(path, content, null);
      await workspace.content.record("pulls", [path], `Open ${pullId}: ${valid.title}`);
      return this.engines.pulls.parse(path, file.content, file.hash);
    });
  }

  updatePull(id: unknown, path: unknown, input: unknown, expectedHash: unknown): Promise<PullRequest> {
    return this.on(id, async (workspace) => {
      const relative = workspace.path(path);
      const { settings } = await workspace.settings();
      if (!this.engines.pulls.isPullFile(relative, settings.pullRoot)) throw new Error(`${relative} is not a pull request.`);
      const valid = this.engines.pulls.validate(input);
      const { files } = await workspace.content.locate("pulls");
      const original = await files.read(relative);
      if (original.hash !== expectedHash) throw new Error("This pull request changed on disk. Reopen it to see the latest version.");
      const pull = this.engines.pulls.parse(relative, original.content, original.hash);
      const file = await files.write(relative, this.engines.pulls.serializeUpdate(original.content, valid), original.hash);
      await workspace.content.record("pulls", [relative], `Update ${pull.id}: ${valid.title}`);
      return this.engines.pulls.parse(relative, file.content, file.hash);
    });
  }

  commentAuthor(id: unknown): Promise<string> {
    return this.on(id, (workspace) => this.author(workspace));
  }

  addComment(id: unknown, path: unknown, text: unknown): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      const comment = this.engines.tasks.validComment(text);
      const author = await this.author(workspace);
      const { files } = await workspace.content.locate("tasks");
      // Comments go last whatever changed meanwhile, so adding one needs no version.
      const original = await files.read(relative);
      const task = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot);
      const file = await files.write(relative, this.engines.tasks.addComment(original.content, author, new Date(), comment), original.hash);
      await workspace.content.record("tasks", [relative], `Comment on ${task.id}`);
      return this.engines.tasks.parse(relative, file.content, file.hash, settings.taskRoot);
    });
  }

  editComment(id: unknown, path: unknown, index: unknown, text: unknown, expectedHash: unknown): Promise<Task> {
    return this.changeComment(id, path, index, expectedHash, "Edit a comment on", (content, at) =>
      this.engines.tasks.editComment(content, at, this.engines.tasks.validComment(text)),
    );
  }

  deleteComment(id: unknown, path: unknown, index: unknown, expectedHash: unknown): Promise<Task> {
    return this.changeComment(id, path, index, expectedHash, "Delete a comment on", (content, at) =>
      this.engines.tasks.removeComment(content, at),
    );
  }

  /** Changes comment `index` of the version `expectedHash` of a task, if the user wrote it. */
  private changeComment(
    id: unknown,
    path: unknown,
    index: unknown,
    expectedHash: unknown,
    message: string,
    change: (content: string, index: number) => string,
  ): Promise<Task> {
    return this.on(id, async (workspace) => {
      const { relative, settings } = await this.taskPath(workspace, path);
      if (!Number.isInteger(index) || (index as number) < 0) throw new Error("Invalid comment.");
      const { files } = await workspace.content.locate("tasks");
      const original = await files.read(relative);
      if (original.hash !== expectedHash) throw new Error("This task changed on disk. Reopen it to see the latest version.");
      const task = this.engines.tasks.parse(relative, original.content, original.hash, settings.taskRoot);
      const comment = task.comments[index as number];
      if (!comment) throw new Error("This comment no longer exists. Reopen the task to see the latest version.");
      if (comment.author !== (await this.author(workspace))) throw new Error("You can only change your own comments.");
      const file = await files.write(relative, change(original.content, index as number), original.hash);
      await workspace.content.record("tasks", [relative], `${message} ${task.id}`);
      return this.engines.tasks.parse(relative, file.content, file.hash, settings.taskRoot);
    });
  }

  /** The name comments are signed with. */
  private async author(workspace: Workspace): Promise<string> {
    const name = this.engines.tasks.commentAuthor((await workspace.content.author()) ?? "");
    if (!name) throw new Error('Tell Git your name first: git config user.name "Your Name"');
    return name;
  }

  /**
   * The task file as last committed: at its path, or, for a task moved to
   * another epic since, the committed file with its name (IDs are unique).
   */
  private async lastCommitted(workspace: Workspace, relative: string, taskRoot: string): Promise<TaskVersion | null> {
    const content = await workspace.content.committed("tasks", relative);
    if (content !== null) return { path: relative, content };
    const name = baseName(relative);
    const moved = (await workspace.content.committedFiles("tasks", taskRoot)).find(
      (file) => baseName(file) === name && this.engines.tasks.isTaskFile(file, taskRoot),
    );
    return moved ? { path: moved, content: await workspace.content.committed("tasks", moved) } : null;
  }

  saveSettings(id: unknown, settings: unknown, expectedHash: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      const { files } = await workspace.content.locate("settings");
      const version = this.version(expectedHash);
      const previous = version === null ? null : (await files.read(SETTINGS_FILE)).content;
      await files.write(SETTINGS_FILE, this.engines.settings.serialize(settings as Settings, previous, workspace.windows), version);
      workspace.forgetSettings();
      await workspace.content.record("settings", [SETTINGS_FILE], "Update Genbeya settings");
    });
  }

  setStorage(id: unknown, area: unknown, mode: unknown): Promise<void> {
    return this.on(id, async (workspace) => {
      if (!CONTENT_AREAS.includes(area as ContentArea)) throw new Error("Invalid content area.");
      if (!STORAGE_MODES.includes(mode as StorageMode)) throw new Error("Invalid storage mode.");
      const { settings } = await workspace.settings();
      const paths: Readonly<Record<ContentArea, string>> = {
        wiki: settings.wikiRoot,
        tasks: settings.taskRoot,
        settings: SETTINGS_FILE,
        pulls: settings.pullRoot,
      };
      await workspace.content.setStorage(area as ContentArea, mode as StorageMode, paths[area as ContentArea]);
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

  search(id: unknown, text: unknown, options?: unknown): Promise<SearchResults> {
    const query = this.engines.search.validate(text, options);
    return this.on(id, (workspace) => searchContent(workspace, this.engines, query));
  }

  people(id: unknown): Promise<People> {
    return this.on(id, async (workspace) => {
      // Re-read, as the snapshot does: people are often added to the file by hand.
      const { settings } = await workspace.settings(true);
      const tasks = await workspace.tasks(await workspace.content.files("tasks"), settings, []);
      const [authors, identity] = await Promise.all([this.commitAuthors(workspace), commitIdentity(workspace.repository.git)]);
      const people = this.engines.people.merge({
        configured: settings.people,
        authors,
        assignees: tasks.map((task) => task.assignee),
        commenters: tasks.flatMap((task) => task.comments.map((comment) => comment.author)),
      });
      return { people, me: this.engines.people.me(people, identity) };
    });
  }

  private async commitAuthors(workspace: Workspace): Promise<AuthorCount[]> {
    const head = await workspace.repository.git.objectId("HEAD");
    let cached = this.authors.get(workspace);
    if (!cached || cached.head !== head) {
      cached = { head, authors: head ? commitAuthors(workspace.repository.git, AUTHOR_COMMITS) : Promise.resolve([]) };
      this.authors.set(workspace, cached);
      cached.authors.catch(() => this.authors.delete(workspace));
    }
    return cached.authors;
  }

  private version(value: unknown): string | null {
    if (value !== null && typeof value !== "string") throw new Error("Invalid file version.");
    return value;
  }

  /** Content edits are committed when their area lives on the content branch; settings edits are re-read. */
  private async afterEdit(workspace: Workspace, scope: Scope, path: string, message: string) {
    if (scope === "content" || path === SETTINGS_FILE) workspace.forgetSettings();
    if (scope === "content") await workspace.content.record(await workspace.areaOf(path), [path], message);
  }

  private moveOptions(value: unknown): PageMove {
    if (value === undefined) return {};
    const options = value as PageMove | null;
    if (typeof options !== "object" || options === null || !["undefined", "boolean"].includes(typeof options.updateLinks))
      throw new Error("Invalid move options.");
    return options;
  }

  /** The renames that move a page, and its subpages when it has them. */
  private async pageMove(workspace: Workspace, from: unknown, to: unknown) {
    const source = await this.pagePath(workspace, from);
    const target = await this.pagePath(workspace, to);
    const { files } = await workspace.content.locate("wiki");
    const hasSubpages = (await files.kind(this.engines.wiki.subpageFolder(source))) === "dir";
    const moves = this.engines.wiki.planMove(source, target, hasSubpages);
    // Subpage folders are derived names: on Windows the page `docs/GIT~1.md` has the folder `docs/GIT~1`.
    for (const path of moves.flat()) workspace.path(path);
    return { source, target, moves };
  }

  /**
   * The Markdown files whose links `moves` would break, rewritten, with the
   * versions they were read at: the files where the wiki lives, and the task
   * folder where the tasks live when that is elsewhere. `area` names the
   * location each is written to, `original` the content it replaces.
   */
  private async linkRewrites(
    workspace: Workspace,
    moves: readonly [string, string][],
  ): Promise<(LinkRewrite & { hash: string; original: string; area: "wiki" | "tasks" })[]> {
    if (!moves.length) return [];
    const { settings } = await workspace.settings();
    const wiki = await workspace.content.locate("wiki");
    const tasks = await workspace.content.locate("tasks");
    const together = wiki.root === tasks.root;
    // Where the tasks live elsewhere, the wiki's location holds at most a stale copy of them.
    const wikiFiles = (await wiki.git.files()).filter((file) => together || !within(file, settings.taskRoot));
    const taskFiles = together ? [] : (await tasks.git.files()).filter((file) => within(file, settings.taskRoot));
    const read = async (location: ContentLocation, list: readonly string[]) =>
      (await location.files.readMany(list.filter((file) => file.toLowerCase().endsWith(".md")))).filter(
        (file): file is VersionedFile => !!file && !(file instanceof Error),
      );
    const documents = [...(await read(wiki, wikiFiles)), ...(await read(tasks, taskFiles))];
    const files = [...wikiFiles, ...taskFiles];
    const taskList = await workspace.tasks(together ? wikiFiles : taskFiles, settings, []);
    const index = (list: readonly string[]) =>
      referenceIndex({ wikiRoot: settings.wikiRoot, pages: this.engines.wiki.pages(list, settings), tasks: taskList, files: list });
    const context = { moves, before: index(files), after: index(files.map((file) => relocate(file, moves) ?? file)) };
    const versions = new Map(documents.map((file) => [file.path, file]));
    const elsewhere = new Set(taskFiles);
    return this.engines.links.rewrite(documents, context).map((rewrite) => ({
      ...rewrite,
      hash: versions.get(rewrite.path)!.hash,
      original: versions.get(rewrite.path)!.content,
      area: elsewhere.has(rewrite.path) ? "tasks" : "wiki",
    }));
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
    if (!this.engines.tasks.isTaskFile(relative, settings.taskRoot))
      throw new Error(`Tasks are Markdown files inside ${settings.taskRoot}/.`);
    return { relative, settings };
  }

  private async templatePath(workspace: Workspace, type: unknown): Promise<string> {
    const { settings } = await workspace.settings();
    return workspace.path(this.engines.tasks.templatePath(settings.taskRoot, type));
  }
}
