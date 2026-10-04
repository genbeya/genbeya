import { createHash } from "node:crypto";
import path from "node:path";
import type {
  CommitDetail,
  Diff,
  DiffSource,
  FileContent,
  Location,
  Remote,
  Scope,
  Settings,
  Snapshot,
  Storage,
  Task,
  TaskInput,
  WorkspaceAPI,
} from "../shared/api.js";
import { Git, GitError, LOG_FORMAT, isCommitId, parseLog, parseNameStatus } from "./git.js";
import { HostError, isMissing, type Host } from "./host.js";
import { createHost } from "./hosts.js";
import { basename, relativePath, within } from "./paths.js";
import {
  SETTINGS_FILE,
  defaultSettings,
  parseSettings,
  serializeSettings,
} from "./settings.js";
import {
  nextTaskId,
  parseTask,
  serializeNewTask,
  serializeTaskUpdate,
  validateTaskInput,
} from "./tasks.js";
import { buildTree, filesUnder, wikiTree } from "./tree.js";

export const FILE_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
};
const NETWORK_TIMEOUT = 5 * 60_000;
const DEFAULT_CONTENT_BRANCH = "gitdesk";

export const hashText = (text: string) => createHash("sha256").update(text).digest("hex");

function decode(data: Buffer, relative: string) {
  if (data.includes(0)) throw new Error(`${relative} is a binary file.`);
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    throw new Error(`${relative} is not UTF-8 text.`);
  }
}

/** Splits paths so command lines stay below Windows' 32K limit. */
function batches(paths: string[], budget = 20_000) {
  const result: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const p of paths) {
    if (current.length && size + p.length + 3 > budget) {
      result.push(current);
      current = [];
      size = 0;
    }
    current.push(p);
    size += p.length + 3;
  }
  if (current.length) result.push(current);
  return result;
}

/** Where wiki pages, tasks and settings live: the checkout itself or a dedicated branch. */
interface Content {
  key: string;
  root: string;
  git: Git;
  branch: string | null;
}

/**
 * One open repository. Every public method is safe to expose to the renderer:
 * arguments are validated here, and {@link exclusive} serializes operations.
 */
export class Workspace implements WorkspaceAPI {
  private queue: Promise<unknown> = Promise.resolve();
  private content: Content;
  private settingsCache: { settings: Settings; hash: string | null; error?: string } | null = null;
  private commitError: string | null = null;

  private constructor(
    readonly location: Location,
    readonly host: Host,
    readonly root: string,
    readonly repo: Git,
  ) {
    this.content = { key: "worktree", root, git: repo, branch: null };
  }

  static async open(location: Location, host: Host = createHost(location)) {
    try {
      const result = await host.run("git", ["rev-parse", "--show-toplevel"], { cwd: location.path });
      if (result.code !== 0) {
        const message = result.stderr.trim();
        throw new Error(
          /not a git repository/i.test(message)
            ? "This folder is not inside a Git repository."
            : /dubious ownership/i.test(message)
              ? "Git refuses this folder because another user owns it. Add it to safe.directory in your Git configuration."
              : message || "Could not open the repository.",
        );
      }
      let root = result.stdout.toString("utf8").trim();
      if (!host.posix) root = path.resolve(root);
      const workspace = new Workspace(location, host, root, new Git(host, root));
      await workspace.resolveContent();
      return workspace;
    } catch (error) {
      host.dispose();
      throw error;
    }
  }

  get name() {
    return this.settingsCache?.settings.name ?? basename(this.root.replace(/\\/g, "/"));
  }

  dispose() {
    this.host.dispose();
  }

  exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  // ---------------------------------------------------------------- content

  private path(value: unknown) {
    return relativePath(value, !this.host.posix);
  }

  private rootOf(scope: Scope) {
    if (scope !== "repo" && scope !== "content") throw new Error("Invalid scope.");
    return scope === "repo" ? this.root : this.content.root;
  }

  async rootPath(scope: Scope) {
    return this.rootOf(scope);
  }

  private async config(key: string) {
    return (await this.repo.try(["config", "--get", key]))?.trim() || null;
  }

  /** Finds (and if needed checks out) the branch that stores wiki and tasks. */
  private async resolveContent(): Promise<Content> {
    const [mode, configured] = await Promise.all([
      this.config("gitdesk.storage"),
      this.config("gitdesk.branch"),
    ]);
    const branch = configured ?? DEFAULT_CONTENT_BRANCH;
    const refs =
      mode === "worktree"
        ? []
        : await this.repo.lines([
            "for-each-ref",
            "--format=%(refname)",
            `refs/heads/${branch}`,
            `refs/remotes/*/${branch}`,
          ]);
    const local = refs.includes(`refs/heads/${branch}`);
    const remote = refs.find((r) => r.startsWith("refs/remotes/"));
    const key = `${mode}|${branch}|${local}|${remote}`;
    if (this.content.key === key && (await this.host.kind(this.content.root, ".")) === "dir")
      return this.content;
    this.settingsCache = null;
    if (!local && !remote) {
      this.content = { key, root: this.root, git: this.repo, branch: null };
      return this.content;
    }
    const ref = `refs/heads/${branch}`;
    let root = (await this.worktrees()).get(ref);
    if (!root) {
      const common = (
        await this.repo.text(["rev-parse", "--path-format=absolute", "--git-common-dir"])
      ).trim();
      root = this.host.join(common, `gitdesk/${branch}`);
      // After the repository folder moved, the worktree is intact but its links are stale.
      if ((await this.host.kind(root, ".").catch(() => null)) === "dir") {
        await this.repo.try(["worktree", "repair", root]);
        root = (await this.worktrees()).get(ref) ?? root;
      }
      await this.repo.text(["worktree", "prune"]);
    }
    if (!(await this.worktrees()).has(ref)) {
      await this.repo.text(
        local
          ? ["worktree", "add", "--quiet", root, branch]
          : ["worktree", "add", "--quiet", "--track", "-b", branch, root, remote!.replace("refs/remotes/", "")],
      );
    }
    if (!this.host.posix) root = path.resolve(root);
    this.content = { key, root, git: root === this.root ? this.repo : new Git(this.host, root), branch };
    return this.content;
  }

  /** Checked-out branches and their worktrees; stale (prunable) entries are left out. */
  private async worktrees() {
    const result = new Map<string, string>();
    const output = await this.repo.text(["worktree", "list", "--porcelain"]);
    for (const block of output.split(/\n\n+/)) {
      const lines = block.split("\n");
      const path = lines.find((l) => l.startsWith("worktree "))?.slice(9);
      const branch = lines.find((l) => l.startsWith("branch "))?.slice(7);
      if (path && branch && !lines.some((l) => l.startsWith("prunable"))) result.set(branch, path);
    }
    return result;
  }

  /** Commits content changes immediately when content lives on its own branch. */
  private async record(paths: string[], message: string) {
    const { git, branch } = this.content;
    if (!branch) return;
    // The file is already saved; a failed commit is reported, not thrown, and
    // the next edit or sync commits whatever is still pending.
    try {
      await git.text(["add", "-A", "--", ...paths]);
      if (await git.text(["diff", "--cached", "--name-only", "-z", "--", ...paths]))
        await git.text(["commit", "--quiet", "-m", message, "--", ...paths]);
      if (this.commitError) await this.commitPending(git);
      this.commitError = null;
    } catch (error) {
      this.commitError = (error as Error).message;
    }
  }

  /** Commits edits left uncommitted by an earlier failure. */
  private async commitPending(git: Git) {
    if (!(await git.text(["status", "--porcelain", "-z"]))) return;
    await git.text(["add", "-A"]);
    await git.text(["commit", "--quiet", "-m", "Commit pending GitDesk edits"]);
  }

  private async loadSettings() {
    const fallback = defaultSettings(basename(this.root.replace(/\\/g, "/")));
    let content: string;
    try {
      content = decode(await this.host.read(this.content.root, SETTINGS_FILE, FILE_LIMIT), SETTINGS_FILE);
    } catch (error) {
      if (!isMissing(error)) throw error;
      return (this.settingsCache = { settings: fallback, hash: null });
    }
    try {
      return (this.settingsCache = { settings: parseSettings(content, fallback), hash: hashText(content) });
    } catch (error: any) {
      // A broken settings file must not lock anyone out of the settings screen.
      return (this.settingsCache = {
        settings: fallback,
        hash: hashText(content),
        error: `${SETTINGS_FILE}: ${error.message} Using defaults until it is fixed.`,
      });
    }
  }

  private async loadTasks(files: string[], settings: Settings, warnings: string[]) {
    const paths = filesUnder(files, settings.taskRoot, ".md");
    const contents = await this.host.readMany(this.content.root, paths, FILE_LIMIT);
    const tasks: Task[] = [];
    const seen = new Map<string, string>();
    paths.forEach((file, i) => {
      const data = contents[i];
      if (!data) return warnings.push(`${file}: could not be read.`);
      try {
        const text = decode(data, file);
        const task = parseTask(file, text, hashText(text));
        const other = seen.get(task.id);
        if (other) warnings.push(`${file}: task ID ${task.id} is also used by ${other}.`);
        else seen.set(task.id, file);
        tasks.push(task);
      } catch (error: any) {
        warnings.push(`${file}: ${error.message}`);
      }
    });
    return tasks;
  }

  // --------------------------------------------------------------- snapshot

  async snapshot(since?: string): Promise<Snapshot | null> {
    const content = await this.resolveContent();
    const separate = content.root !== this.root;
    const [repoFiles, status, branchRefs, remoteText, contentFiles, contentStatus, { settings, hash, error }] =
      await Promise.all([
        this.repo.files(),
        this.repo.status(),
        this.repo.lines(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]),
        this.repo.text(["remote", "-v"]),
        separate ? content.git.files() : null,
        separate ? content.git.status() : null,
        this.loadSettings(),
      ]);
    const warnings = error ? [error] : [];
    if (this.commitError && content.branch)
      warnings.push(`Saved, but not committed to the ${content.branch} branch: ${this.commitError}`);
    const files = contentFiles ?? repoFiles;
    const tasks = await this.loadTasks(files, settings, warnings);
    if (contentStatus?.changes.length)
      warnings.push(
        `${contentStatus.changes.length} file(s) on the ${content.branch} branch are not committed. Commit them in ${content.root}.`,
      );

    const branches = branchRefs.filter((r) => r.startsWith("refs/heads/")).map((r) => r.slice(11));
    const remoteBranches = branchRefs
      .filter((r) => r.startsWith("refs/remotes/") && !r.endsWith("/HEAD"))
      .map((r) => r.slice(13))
      .filter((r) => !branches.includes(r.slice(r.indexOf("/") + 1)));
    const remotes: Remote[] = [];
    for (const line of remoteText.split("\n")) {
      const match = /^(\S+)\t(.+) \(fetch\)$/.exec(line);
      if (match) remotes.push({ name: match[1], url: match[2] });
    }
    const storage: Storage = content.branch
      ? {
          mode: "branch",
          branch: content.branch,
          remote: contentStatus?.head.upstream?.split("/")[0] ?? (await this.config(`branch.${content.branch}.remote`)),
          ahead: contentStatus?.head.ahead ?? 0,
          behind: contentStatus?.head.behind ?? 0,
        }
      : { mode: "worktree" };
    const contentTree = separate ? buildTree(files) : null;
    const repoTree = buildTree(repoFiles);
    const body: Omit<Snapshot, "version"> = {
      location: this.location,
      settings,
      settingsHash: hash,
      storage,
      head: status.head,
      branches,
      remoteBranches,
      remotes,
      changes: status.changes,
      files: repoTree,
      wiki: wikiTree(contentTree ?? repoTree, settings.wikiRoot, settings.wikiHome),
      tasks,
      warnings,
    };
    const version = hashText(JSON.stringify(body));
    return since === version ? null : { version, ...body };
  }

  // ------------------------------------------------------------------ files

  async read(scope: Scope, value: string): Promise<FileContent> {
    const relative = this.path(value);
    const content = decode(await this.host.read(this.rootOf(scope), relative, FILE_LIMIT), relative);
    return { scope, path: relative, content, hash: hashText(content) };
  }

  async image(scope: Scope, value: string) {
    const relative = this.path(value);
    const type = IMAGE_TYPES[relative.slice(relative.lastIndexOf(".") + 1).toLowerCase()];
    if (!type) throw new Error(`${relative} is not a supported image.`);
    const data = await this.host.read(this.rootOf(scope), relative, IMAGE_LIMIT);
    return `data:${type};base64,${data.toString("base64")}`;
  }

  private async current(root: string, relative: string) {
    try {
      return hashText(decode(await this.host.read(root, relative, FILE_LIMIT), relative));
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  private async put(scope: Scope, relative: string, content: string, expectedHash: string | null) {
    if (typeof content !== "string" || Buffer.byteLength(content) > FILE_LIMIT)
      throw new Error("Files are limited to 2 MiB.");
    const root = this.rootOf(scope);
    const actual = await this.current(root, relative);
    if (actual !== null && expectedHash === null) throw new HostError("EXISTS", relative);
    if (actual !== expectedHash)
      throw new Error(`${relative} changed on disk. Reload it before saving; your edits are kept.`);
    await this.host.write(root, relative, Buffer.from(content, "utf8"), actual === null);
    return { scope, path: relative, content, hash: hashText(content) };
  }

  async write(scope: Scope, value: string, content: string, expectedHash: string | null) {
    const relative = this.path(value);
    const file = await this.put(scope, relative, content, expectedHash);
    if (relative === SETTINGS_FILE) this.settingsCache = null;
    if (scope === "content") await this.record([relative], `Edit ${relative}`);
    return file;
  }

  async remove(scope: Scope, value: string) {
    const relative = this.path(value);
    await this.host.remove(this.rootOf(scope), relative);
    if (relative === SETTINGS_FILE) this.settingsCache = null;
    if (scope === "content") await this.record([relative], `Delete ${relative}`);
  }

  // ------------------------------------------------------------------- wiki

  private async page(value: unknown) {
    const relative = this.path(value);
    const { settings } = this.settingsCache ?? (await this.loadSettings());
    if (!within(relative, settings.wikiRoot) || !relative.endsWith(".md"))
      throw new Error(`Pages are Markdown files inside ${settings.wikiRoot}/.`);
    return relative;
  }

  async createPage(value: string) {
    const relative = await this.page(value);
    const title = basename(relative).slice(0, -3);
    const file = await this.put("content", relative, `# ${title}\n\n`, null);
    await this.record([relative], `Create page ${title}`);
    return file;
  }

  async movePage(fromValue: string, toValue: string) {
    const from = await this.page(fromValue);
    const to = await this.page(toValue);
    if (from === to) return to;
    const root = this.content.root;
    const folder = from.slice(0, -3);
    const target = to.slice(0, -3);
    const hasFolder = (await this.host.kind(root, folder)) === "dir";
    if (hasFolder && within(to, folder)) throw new Error("A page cannot move below itself.");
    if (hasFolder && (await this.host.kind(root, target))) throw new HostError("EXISTS", target);
    await this.host.move(root, from, to);
    if (hasFolder) await this.host.move(root, folder, target);
    await this.record(
      hasFolder ? [from, to, folder, target] : [from, to],
      `Move page ${basename(folder)} to ${target}`,
    );
    return to;
  }

  async deletePage(value: string) {
    const relative = await this.page(value);
    const folder = relative.slice(0, -3);
    if ((await this.host.kind(this.content.root, folder)) === "dir") {
      const files = await this.content.git.files();
      if (files.some((f) => within(f, folder)))
        throw new Error("This page has subpages. Move or delete them first.");
    }
    await this.host.remove(this.content.root, relative);
    await this.record([relative], `Delete page ${basename(folder)}`);
  }

  // ------------------------------------------------------------------ tasks

  private async taskPath(value: unknown) {
    const relative = this.path(value);
    const { settings } = this.settingsCache ?? (await this.loadSettings());
    if (!within(relative, settings.taskRoot) || !relative.endsWith(".md"))
      throw new Error(`Tasks are Markdown files inside ${settings.taskRoot}/.`);
    return { relative, settings };
  }

  async createTask(input: TaskInput) {
    const { settings } = await this.loadSettings();
    const valid = validateTaskInput(input, settings.statuses);
    const files = await this.content.git.files();
    const tasks = await this.loadTasks(files, settings, []);
    // Free IDs can still collide with tasks named after them on other branches.
    let id = nextTaskId(settings.taskPrefix, tasks.map((t) => t.id));
    while (files.includes(`${settings.taskRoot}/${id}.md`))
      id = nextTaskId(settings.taskPrefix, [id]);
    const relative = `${settings.taskRoot}/${id}.md`;
    const file = await this.put("content", relative, serializeNewTask(id, valid), null);
    await this.record([relative], `Create ${id}: ${valid.title}`);
    return parseTask(relative, file.content, file.hash);
  }

  async updateTask(value: string, input: TaskInput, expectedHash: string) {
    const { relative, settings } = await this.taskPath(value);
    const valid = validateTaskInput(input, settings.statuses);
    const original = await this.read("content", relative);
    if (original.hash !== expectedHash)
      throw new Error("This task changed on disk. Reopen it to see the latest version.");
    const task = parseTask(relative, original.content, original.hash);
    const file = await this.put("content", relative, serializeTaskUpdate(original.content, valid), expectedHash);
    await this.record([relative], `Update ${task.id}: ${valid.title}`);
    return parseTask(relative, file.content, file.hash);
  }

  async deleteTask(value: string) {
    const { relative } = await this.taskPath(value);
    const original = await this.read("content", relative);
    let id = basename(relative).slice(0, -3);
    try {
      id = parseTask(relative, original.content, original.hash).id;
    } catch {
      /* Delete unreadable task files too. */
    }
    await this.host.remove(this.content.root, relative);
    await this.record([relative], `Delete ${id}`);
  }

  // ---------------------------------------------------------- version control

  private async show(spec: string) {
    const result = await this.host.run("git", ["show", spec], { cwd: this.root });
    return result.code === 0 ? result.stdout : Buffer.alloc(0);
  }

  async diff(value: string, source: DiffSource, oldValue?: string): Promise<Diff> {
    const relative = this.path(value);
    const old = oldValue ? this.path(oldValue) : relative;
    let before: Buffer, after: Buffer;
    if (source === "worktree") {
      before = await this.show(`:${relative}`);
      after = await this.host.read(this.root, relative, FILE_LIMIT).catch((error) => {
        if (isMissing(error)) return Buffer.alloc(0);
        throw error;
      });
    } else if (source === "index") {
      before = await this.show(`HEAD:${old}`);
      after = await this.show(`:${relative}`);
    } else if (source && isCommitId(source.commit)) {
      before = await this.show(`${source.commit}^:${old}`);
      after = await this.show(`${source.commit}:${relative}`);
    } else throw new Error("Invalid diff source.");
    const binary =
      before.includes(0) || after.includes(0) || before.length > FILE_LIMIT || after.length > FILE_LIMIT;
    return {
      path: relative,
      binary,
      original: binary ? "" : before.toString("utf8"),
      modified: binary ? "" : after.toString("utf8"),
    };
  }

  private paths(values: unknown) {
    if (!Array.isArray(values) || !values.length || values.length > 10_000) throw new Error("Select files first.");
    return values.map((v) => this.path(v));
  }

  async stage(values: string[]) {
    for (const batch of batches(this.paths(values))) await this.repo.text(["add", "-A", "--", ...batch]);
  }

  async unstage(values: string[]) {
    const paths = this.paths(values);
    const { changes } = await this.repo.status();
    const all = new Set(paths);
    for (const change of changes) if (all.has(change.path) && change.oldPath) all.add(change.oldPath);
    const head = await this.repo.try(["rev-parse", "--verify", "--quiet", "HEAD"]);
    for (const batch of batches([...all]))
      if (head) await this.repo.text(["restore", "--staged", "--", ...batch]);
      else await this.repo.text(["rm", "--cached", "--quiet", "-r", "--", ...batch]);
  }

  /** Reverts working-tree edits to the staged version; deletes untracked files. */
  async discard(values: string[]) {
    const paths = new Set(this.paths(values));
    const { changes } = await this.repo.status();
    const untracked = changes.filter((c) => c.index === "?" && paths.has(c.path)).map((c) => c.path);
    const tracked = changes
      .filter((c) => c.index !== "?" && c.worktree !== " " && paths.has(c.path))
      .map((c) => c.path);
    for (const batch of batches(tracked)) await this.repo.text(["restore", "--worktree", "--", ...batch]);
    for (const file of untracked) await this.host.remove(this.root, file);
  }

  async commit(message: string, amend: boolean) {
    if (typeof message !== "string" || !message.trim() || message.length > 20_000)
      throw new Error("Write a commit message first.");
    await this.repo.text(["commit", "--quiet", ...(amend ? ["--amend"] : []), "-m", message.trim()]);
  }

  async lastCommitMessage() {
    return ((await this.repo.try(["log", "-1", "--format=%B"])) ?? "").trim();
  }

  async log(skip: number, limit: number) {
    if (!Number.isInteger(skip) || !Number.isInteger(limit) || skip < 0 || limit < 1 || limit > 1000)
      throw new Error("Invalid history range.");
    const output = await this.repo.try([
      "log", "--all", "--topo-order", `--skip=${skip}`, `--max-count=${limit}`, `--format=${LOG_FORMAT}`,
    ]);
    return parseLog(output ?? "");
  }

  async commitDetail(hash: string): Promise<CommitDetail> {
    if (!isCommitId(hash)) throw new Error("Invalid commit ID.");
    const [meta, body, files] = await Promise.all([
      this.repo.text(["log", "-1", `--format=${LOG_FORMAT}`, hash]),
      this.repo.text(["log", "-1", "--format=%b", hash]),
      this.repo.text([
        "diff-tree", "--root", "-r", "--no-commit-id", "--name-status", "-z", "-M",
        // Merges are compared with their first parent, matching diff().
        "--diff-merges=first-parent", hash,
      ]),
    ]);
    return { commit: parseLog(meta)[0], body: body.trim(), files: parseNameStatus(files) };
  }

  private async branchName(name: unknown) {
    if (typeof name !== "string" || !name || name.length > 200 || name.startsWith("-"))
      throw new Error("Invalid branch name.");
    await this.repo.text(["check-ref-format", "--branch", name]).catch(() => {
      throw new Error(`"${name}" is not a valid branch name.`);
    });
    return name;
  }

  async switchBranch(name: string) {
    const branch = await this.branchName(name);
    // Remote-only branches are checked out as new tracking branches.
    const remote = /^[^/]+\/(.+)$/.exec(branch);
    const local = await this.repo.try(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
    if (!local && remote && (await this.repo.try(["rev-parse", "--verify", "--quiet", `refs/remotes/${branch}`])))
      await this.repo.text(["switch", "--track", branch]);
    else await this.repo.text(["switch", branch]);
  }

  async createBranch(name: string) {
    await this.repo.text(["switch", "--create", await this.branchName(name)]);
  }

  private async remoteName(name: unknown) {
    const remotes = await this.repo.lines(["remote"]);
    if (typeof name !== "string" || !remotes.includes(name)) throw new Error("Choose a configured remote.");
    return name;
  }

  async sync(action: "fetch" | "pull" | "push", name: string) {
    const remote = await this.remoteName(name);
    const { head } = await this.repo.status();
    if (action === "fetch") await this.repo.text(["fetch", "--prune", remote], NETWORK_TIMEOUT);
    else if (!head.branch) throw new Error("Switch to a branch first.");
    else if (action === "pull")
      await this.repo.text(["pull", "--ff-only", remote, head.branch], NETWORK_TIMEOUT);
    else if (action === "push")
      await this.repo.text(["push", "--set-upstream", remote, head.branch], NETWORK_TIMEOUT);
    else throw new Error("Invalid action.");
  }

  async setRemote(name: string, url: string) {
    if (typeof name !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name))
      throw new Error("Remote names use letters, digits, dots, dashes and underscores.");
    if (typeof url !== "string" || !url.trim() || url.length > 2048 || url.startsWith("-") || /[\r\n\0]/.test(url))
      throw new Error("Enter a valid remote URL or path.");
    const exists = (await this.repo.lines(["remote"])).includes(name);
    await this.repo.text(["remote", exists ? "set-url" : "add", name, url.trim()]);
  }

  async removeRemote(name: string) {
    await this.repo.text(["remote", "remove", await this.remoteName(name)]);
  }

  // --------------------------------------------------------------- settings

  async saveSettings(settings: Settings, expectedHash: string | null) {
    let previous: string | null = null;
    if (expectedHash !== null) previous = (await this.read("content", SETTINGS_FILE)).content;
    await this.put("content", SETTINGS_FILE, serializeSettings(settings, previous), expectedHash);
    this.settingsCache = null;
    await this.record([SETTINGS_FILE], "Update GitDesk settings");
  }

  /**
   * Moves wiki and task storage to a dedicated branch (created on first use
   * from the committed wiki, tasks and settings) or back to the checkout.
   */
  async setStorage(mode: "worktree" | "branch") {
    if (mode !== "worktree" && mode !== "branch") throw new Error("Invalid storage mode.");
    await this.repo.text(["config", "gitdesk.storage", mode]);
    if (mode === "worktree") {
      await this.resolveContent();
      return;
    }
    const branch = (await this.config("gitdesk.branch")) ?? DEFAULT_CONTENT_BRANCH;
    const exists = await this.repo.lines([
      "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`, `refs/remotes/*/${branch}`,
    ]);
    if (exists.length) {
      await this.resolveContent();
      return;
    }
    const { settings } = await this.loadSettings();
    // The empty tree must exist as an object, or `git fsck` reports it missing.
    const common = (await this.repo.text(["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();
    await this.host.write(common, "gitdesk-empty", Buffer.alloc(0), false);
    const emptyTree = (
      await this.repo.text(["hash-object", "-w", "-t", "tree", this.host.join(common, "gitdesk-empty")])
    ).trim();
    await this.host.remove(common, "gitdesk-empty");
    const start = (
      await this.repo.text(["commit-tree", emptyTree, "-m", "Start the GitDesk content branch"])
    ).trim();
    await this.repo.text(["branch", branch, start]);
    const content = await this.resolveContent();
    const head = await this.repo.try(["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (!head) return;
    const copied: string[] = [];
    for (const item of [settings.wikiRoot, settings.taskRoot, SETTINGS_FILE])
      if ((await this.repo.try(["cat-file", "-e", `HEAD:${item}`])) !== null) {
        await content.git.text(["checkout", head.trim(), "--", item]);
        copied.push(item);
      }
    if (copied.length)
      await content.git.text(["commit", "--quiet", "-m", "Copy wiki and tasks from the main checkout"]);
  }

  /** Rebases local wiki/task commits onto the remote branch, then pushes them. */
  async syncContent() {
    const { git, branch } = await this.resolveContent();
    if (!branch) throw new Error("Wiki and tasks are stored in the checkout; use Pull and Push instead.");
    const remotes = await this.repo.lines(["remote"]);
    const remote =
      (await this.config(`branch.${branch}.remote`)) ??
      (remotes.includes("origin") ? "origin" : remotes[0]);
    if (!remote) throw new Error("Add a remote in Settings to share wiki and tasks.");
    const fetched = await this.host.run(
      "git",
      ["-c", "core.hooksPath=" + (this.host.posix ? "/dev/null" : "NUL"), "fetch", remote, branch],
      { cwd: git.cwd, timeout: NETWORK_TIMEOUT },
    );
    await this.commitPending(git);
    if (fetched.code === 0) {
      try {
        await git.text(["rebase", `refs/remotes/${remote}/${branch}`]);
      } catch (error) {
        await git.try(["rebase", "--abort"]);
        throw new GitError(
          `Wiki or task edits conflict with ${remote}/${branch}. Resolve the rebase in a terminal at ${git.cwd}. (${(error as Error).message})`,
        );
      }
    } else if (!/couldn't find remote ref/i.test(fetched.stderr))
      throw new GitError(fetched.stderr.trim());
    await git.text(["push", "--set-upstream", remote, branch], NETWORK_TIMEOUT);
  }
}

