import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import YAML from "yaml";
import type {
  Change,
  Commit,
  Diff,
  FileContent,
  FileNode,
  Remote,
  Settings,
  Snapshot,
  Task,
  TaskInput,
  WikiNode,
} from "../shared/types.js";

const exec = promisify(execFile);
const LIMIT = 2 * 1024 * 1024;
const DEFAULTS: Settings = {
  name: "My project",
  wikiRoot: "docs",
  wikiHome: "Home.md",
  taskRoot: "tasks",
  statuses: ["backlog", "in-progress", "review", "done"],
};
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const slash = (s: string) => s.split(path.sep).join("/");
const bounded = (v: unknown, label: string, max = 200) => {
  if (typeof v !== "string" || v.length > max || v.includes("\0"))
    throw new Error(`Invalid ${label}.`);
  return v;
};
// Windows ignores trailing dots/spaces and resolves 8.3 short names, so `.git.`,
// `.git ` and `GIT~1` can all address the .git directory; `:` selects NTFS streams.
const windows = process.platform === "win32";
const protectedSegment = (p: string) =>
  p.replace(/[. ]+$/, "").toLowerCase() === ".git" ||
  (windows && (/^git~\d+$/i.test(p) || /[. ]$/.test(p) || p.includes(":")));
export function relativePath(v: unknown): string {
  const s = bounded(v, "repository path", 4096);
  if (
    !s ||
    path.isAbsolute(s) ||
    /^[a-z]:/i.test(s) ||
    s.includes("\\") ||
    s
      .split("/")
      .some((p) => !p || p === ".." || p === "." || protectedSegment(p))
  )
    throw new Error(
      "Use a relative path within the repository; .git is protected.",
    );
  return s;
}
export function validateSettings(value: Settings): Settings {
  const name = bounded(value.name, "project name").trim();
  if (!name) throw new Error("Project name is required.");
  const wikiRoot = relativePath(value.wikiRoot),
    taskRoot = relativePath(value.taskRoot),
    wikiHome = relativePath(value.wikiHome);
  if (!wikiHome.endsWith(".md"))
    throw new Error("The wiki home must be a Markdown file.");
  if (
    wikiRoot === taskRoot ||
    wikiRoot.startsWith(taskRoot + "/") ||
    taskRoot.startsWith(wikiRoot + "/")
  )
    throw new Error("Wiki and task directories must be separate.");
  if (
    !Array.isArray(value.statuses) ||
    value.statuses.length < 1 ||
    value.statuses.length > 12 ||
    new Set(value.statuses).size !== value.statuses.length ||
    value.statuses.some(
      (s) => typeof s !== "string" || !s.trim() || s.length > 60,
    )
  )
    throw new Error("Use 1–12 unique, nonempty workflow states.");
  return { name, wikiRoot, taskRoot, wikiHome, statuses: value.statuses };
}
export function parseStatus(output: string): Change[] {
  const fields = output.split("\0");
  const changes: Change[] = [];
  for (let i = 0; i < fields.length; i++) {
    const record = fields[i];
    if (!record) continue;
    const xy = record.slice(0, 2),
      p = record.slice(3);
    changes.push({
      path: p,
      index: xy[0],
      worktree: xy[1],
      ...(/[RC]/.test(xy) ? { oldPath: fields[++i] } : {}),
    });
  }
  return changes;
}
function frontmatter(raw: string) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const document = YAML.parseDocument(match?.[1] ?? "");
  if (document.errors.length)
    throw new Error("Invalid YAML frontmatter: " + document.errors[0].message);
  const metadata = document.toJS();
  if (
    metadata !== null &&
    (typeof metadata !== "object" || Array.isArray(metadata))
  )
    throw new Error("Task frontmatter must be a mapping.");
  return {
    document,
    metadata: metadata ?? {},
    body: match ? raw.slice(match[0].length) : raw,
  };
}
function taskFrom(file: FileContent): Task {
  const { metadata: m, body } = frontmatter(file.content);
  if (!m.id || !m.title || !m.status)
    throw new Error("Task needs id, title, and status in frontmatter.");
  return {
    id: String(m.id),
    path: file.path,
    title: String(m.title),
    status: String(m.status),
    priority: String(m.priority ?? "medium"),
    assignee: String(m.assignee ?? ""),
    labels: Array.isArray(m.labels) ? m.labels.map(String) : [],
    body,
    hash: file.hash,
  };
}
function validateTask(input: TaskInput, settings: Settings) {
  if (!bounded(input.title, "task title", 300).trim())
    throw new Error("Task title is required.");
  if (!settings.statuses.includes(input.status))
    throw new Error("Select a configured workflow state.");
  bounded(input.priority, "priority", 60);
  bounded(input.assignee, "assignee", 200);
  bounded(input.body, "task body", LIMIT);
  if (!Array.isArray(input.labels) || input.labels.length > 50)
    throw new Error("Too many labels.");
  input.labels.forEach((label) => bounded(label, "label", 100));
}
export class RepositoryEngine {
  readonly root: string;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(root: string) {
    this.root = root;
  }
  static async open(folder: string) {
    const location = await fs.realpath(folder);
    let result;
    try {
      result = await exec(
        "git",
        ["-C", location, "rev-parse", "--show-toplevel"],
        { timeout: 10000 },
      );
    } catch (error: any) {
      if (error.code === "ENOENT")
        throw new Error("Git was not found. Install Git and add it to PATH.");
      throw new Error(
        /not a git repository/i.test(String(error.stderr))
          ? "The selected folder is not inside a Git repository."
          : String(error.stderr || error.message).trim(),
      );
    }
    return new RepositoryEngine(await fs.realpath(result.stdout.trim()));
  }
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async git(args: string[], allowFailure = false): Promise<string> {
    try {
      const { stdout } = await exec(
        "git",
        [
          "-c",
          "core.quotepath=false",
          "-c",
          "core.hooksPath=" +
            (process.platform === "win32" ? "NUL" : "/dev/null"),
          ...args,
        ],
        {
          cwd: this.root,
          encoding: "utf8",
          timeout: 90000,
          maxBuffer: 16 * 1024 * 1024,
          // Paths are file names, never globs or `:(magic)` pathspecs.
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_LITERAL_PATHSPECS: "1",
          },
        },
      );
      return stdout;
    } catch (error: any) {
      if (allowFailure) return "";
      throw new Error(String(error.stderr || error.message).trim());
    }
  }
  private async safe(v: string, creating = false): Promise<string> {
    const rel = relativePath(v);
    const absolute = path.join(this.root, rel);
    let current = this.root;
    for (const segment of rel.split("/")) {
      current = path.join(current, segment);
      try {
        const stat = await fs.lstat(current);
        if (stat.isSymbolicLink())
          throw new Error(
            "Symbolic links cannot be read or edited in this proof of concept.",
          );
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
        if (creating) continue;
        throw Object.assign(new Error(`${rel} does not exist.`), {
          code: "ENOENT",
        });
      }
    }
    return absolute;
  }
  async read(v: string): Promise<FileContent> {
    const absolute = await this.safe(v);
    const stat = await fs.stat(absolute);
    if (!stat.isFile() || stat.size > LIMIT)
      throw new Error("Only text files up to 2 MiB can be opened.");
    const bytes = await fs.readFile(absolute);
    if (bytes.includes(0)) throw new Error("Binary files cannot be edited.");
    let content: string;
    try {
      content = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      throw new Error("Only UTF-8 text files can be edited.");
    }
    return { path: v, content, hash: hash(content) };
  }
  async save(
    v: string,
    content: string,
    expectedHash: string | null,
  ): Promise<FileContent> {
    bounded(content, "file content", LIMIT);
    if (Buffer.byteLength(content, "utf8") > LIMIT)
      throw new Error("Text files are limited to 2 MiB.");
    const absolute = await this.safe(v, true);
    let actual: string | null = null;
    try {
      actual = (await this.read(v)).hash;
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    if (actual !== null && expectedHash === null)
      throw new Error(`${v} already exists.`);
    if (actual !== expectedHash)
      throw new Error(
        "This file changed on disk. Reload it before saving; your unsaved text is still in the editor.",
      );
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    // Recheck after mkdir; all app writes are serialized by the transport.
    await this.safe(v, true);
    if (actual === null) {
      await fs.writeFile(absolute, content, { flag: "wx" });
    } else {
      await fs.writeFile(absolute, content);
    }
    return { path: v, content, hash: hash(content) };
  }
  private async settings(): Promise<{
    settings: Settings;
    settingsHash: string | null;
    error?: string;
  }> {
    const fallback = { ...DEFAULTS, name: path.basename(this.root) };
    let file: FileContent;
    try {
      file = await this.read(".gitdesk.yml");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      return { settings: fallback, settingsHash: null };
    }
    // A broken settings file must not lock the user out of the settings screen.
    try {
      const document = YAML.parseDocument(file.content);
      if (document.errors.length) throw document.errors[0];
      const data = document.toJS() ?? {};
      if (typeof data !== "object" || Array.isArray(data))
        throw new Error("Settings must be a YAML mapping.");
      return {
        settings: validateSettings({ ...DEFAULTS, ...data }),
        settingsHash: file.hash,
      };
    } catch (error: any) {
      return {
        settings: fallback,
        settingsHash: file.hash,
        error: `.gitdesk.yml: ${error.message} Using defaults until it is fixed.`,
      };
    }
  }
  async saveSettings(settings: Settings, expectedHash: string | null) {
    const valid = validateSettings(settings);
    let doc = YAML.parseDocument("");
    if (expectedHash !== null) {
      const existing = YAML.parseDocument(
        (await this.read(".gitdesk.yml")).content,
      );
      if (!existing.errors.length && YAML.isMap(existing.contents))
        doc = existing;
    }
    for (const [key, value] of Object.entries(valid)) doc.set(key, value);
    await this.save(".gitdesk.yml", doc.toString(), expectedHash);
  }
  async snapshot(): Promise<Snapshot> {
    const { settings, settingsHash, error } = await this.settings();
    const warnings: string[] = error ? [error] : [];
    const excluded = new Set([".git", "node_modules"]);
    // Ignored directories are reported once (`dir/`) rather than file by file.
    const ignored = new Set(
      (
        await this.git(
          [
            "ls-files",
            "-z",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
          ],
          true,
        )
      )
        .split("\0")
        .filter(Boolean)
        .map((p) => p.replace(/\/$/, "")),
    );
    let count = 0;
    const tree = async (dir: string, depth = 0): Promise<FileNode[]> => {
      if (depth > 30) return [];
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error: any) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
      const nodes: FileNode[] = [];
      for (const entry of entries.sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      )) {
        if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name),
          rel = slash(path.relative(this.root, full));
        if (ignored.has(rel)) continue;
        if (++count > 10000) {
          if (!warnings.includes("File tree limited to 10,000 entries."))
            warnings.push("File tree limited to 10,000 entries.");
          break;
        }
        nodes.push({
          name: entry.name,
          path: rel,
          directory: entry.isDirectory(),
          ...(entry.isDirectory()
            ? { children: await tree(full, depth + 1) }
            : {}),
        });
      }
      return nodes;
    };
    const files = await tree(this.root);
    const locate = (rel: string) => {
      let level = files;
      let found: FileNode | undefined;
      for (const part of rel.split("/")) {
        found = level.find((n) => n.name === part);
        level = found?.children ?? [];
      }
      return found;
    };
    const home = settings.wikiHome.split("/").pop()!.slice(0, -3);
    const wikiNodes = (nodes: FileNode[], top = false): WikiNode[] => {
      const directories = nodes.filter((n) => n.directory);
      const pages = nodes.filter((n) => !n.directory && n.name.endsWith(".md"));
      const result: WikiNode[] = directories.map((dir) => {
        const page = pages.find((p) => p.name === dir.name + ".md");
        return {
          title: dir.name,
          path: page?.path ?? null,
          directory: dir.path,
          children: wikiNodes(dir.children ?? []),
        };
      });
      for (const page of pages)
        if (!directories.some((dir) => page.name === dir.name + ".md"))
          result.push({
            title: page.name.slice(0, -3),
            path: page.path,
            children: [],
          });
      return result.sort(
        (a, b) =>
          Number(top && b.title === home) - Number(top && a.title === home) ||
          a.title.localeCompare(b.title),
      );
    };
    const taskFiles: FileNode[] = [];
    const gather = (nodes: FileNode[]) => {
      for (const n of nodes) {
        if (n.directory) gather(n.children ?? []);
        else if (n.name.endsWith(".md")) taskFiles.push(n);
      }
    };
    gather(locate(settings.taskRoot)?.children ?? []);
    const tasks: Task[] = [];
    const ids = new Map<string, string>();
    for (const f of taskFiles) {
      try {
        const task = taskFrom(await this.read(f.path));
        const other = ids.get(task.id);
        if (other)
          warnings.push(
            `${f.path}: task ID ${task.id} is also used by ${other}.`,
          );
        else ids.set(task.id, f.path);
        tasks.push(task);
      } catch (error: any) {
        warnings.push(`${f.path}: ${error.message}`);
      }
    }
    const [status, branch, branches, log, remoteNames] = await Promise.all([
      this.git(["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
      this.git(["symbolic-ref", "--short", "HEAD"], true),
      this.git(["for-each-ref", "--format=%(refname:short)", "refs/heads/"]),
      this.git(
        [
          "log",
          "--all",
          "--topo-order",
          "-n",
          "200",
          "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%D%x00",
        ],
        true,
      ),
      this.git(["remote"]),
    ]);
    const parts = log.split("\0");
    const commits: Commit[] = [];
    for (let i = 0; i + 5 < parts.length; i += 6) {
      const id = parts[i].trim();
      if (id)
        commits.push({
          hash: id,
          parents: parts[i + 1].split(" ").filter(Boolean),
          author: parts[i + 2],
          date: parts[i + 3],
          subject: parts[i + 4],
          refs: parts[i + 5],
        });
    }
    const remotes: Remote[] = await Promise.all(
      remoteNames
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(async (name) => ({
          name,
          url: (await this.git(["remote", "get-url", name])).trim(),
        })),
    );
    return {
      repo: this.root,
      settings,
      settingsHash,
      branch:
        branch.trim() ||
        (await this.git(["rev-parse", "--short", "HEAD"], true)).trim() ||
        "unborn",
      branches: branches.trim().split("\n").filter(Boolean),
      changes: parseStatus(status),
      commits,
      remotes,
      files,
      wiki: wikiNodes(locate(settings.wikiRoot)?.children ?? [], true),
      tasks,
      warnings,
    };
  }
  async createPage(v: string, title: string) {
    const { settings } = await this.settings();
    relativePath(v);
    if (!v.startsWith(settings.wikiRoot + "/") || !v.endsWith(".md"))
      throw new Error(
        "Pages must be Markdown files inside the configured wiki root.",
      );
    return this.save(
      v,
      "# " + bounded(title, "page title", 300).replace(/[\r\n]/g, " ") + "\n\n",
      null,
    );
  }
  async createTask(input: TaskInput): Promise<Task> {
    const { settings } = await this.settings();
    validateTask(input, settings);
    const id = randomUUID();
    const doc = YAML.stringify({ id, ...input, body: undefined });
    const file = await this.save(
      `${settings.taskRoot}/${id}.md`,
      `---\n${doc}---\n${input.body}`,
      null,
    );
    return taskFrom(file);
  }
  async updateTask(
    v: string,
    input: TaskInput,
    expectedHash: string,
  ): Promise<Task> {
    const { settings } = await this.settings();
    validateTask(input, settings);
    if (!v.startsWith(settings.taskRoot + "/") || !v.endsWith(".md"))
      throw new Error("Task is outside the configured task root.");
    const original = await this.read(v);
    taskFrom(original);
    const { document } = frontmatter(original.content);
    for (const key of [
      "title",
      "status",
      "priority",
      "assignee",
      "labels",
    ] as const)
      document.set(key, input[key]);
    return taskFrom(
      await this.save(
        v,
        `---\n${document.toString()}---\n${input.body}`,
        expectedHash,
      ),
    );
  }
  async diff(v: string, staged: boolean, commit?: string): Promise<Diff> {
    relativePath(v);
    let original = "",
      modified = "",
      patch = "";
    if (commit) {
      await this.requireCommit(commit);
      original = await this.git(["show", `${commit}^:${v}`], true);
      modified = await this.git(["show", `${commit}:${v}`], true);
      patch = await this.git([
        "diff-tree",
        "-p",
        "--root",
        "--no-commit-id",
        "--diff-merges=first-parent",
        "--no-ext-diff",
        "--no-textconv",
        commit,
        "--",
        v,
      ]);
    } else if (staged) {
      original = await this.git(["show", `HEAD:${v}`], true);
      modified = await this.git(["show", `:${v}`], true);
      patch = await this.git([
        "diff",
        "--cached",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        v,
      ]);
    } else {
      original = await this.git(["show", `:${v}`], true);
      try {
        modified = (await this.read(v)).content;
      } catch (error: any) {
        if (error.code !== "ENOENT") throw error;
      }
      patch = await this.git([
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--",
        v,
      ]);
    }
    if (
      original.length > LIMIT ||
      modified.length > LIMIT ||
      original.includes("\0") ||
      modified.includes("\0")
    )
      throw new Error("Diff viewer supports text files up to 2 MiB.");
    return { path: v, original, modified, patch };
  }
  async stage(v: string) {
    relativePath(v);
    await this.safe(v, true);
    await this.git(["add", "--", v]);
  }
  async unstage(v: string) {
    relativePath(v);
    const change = parseStatus(
      await this.git([
        "status",
        "--porcelain=v1",
        "--untracked-files=all",
        "-z",
      ]),
    ).find((c) => c.path === v);
    const paths = change?.oldPath ? [v, change.oldPath] : [v];
    const head = await this.git(["rev-parse", "--verify", "HEAD"], true);
    if (head) await this.git(["restore", "--staged", "--", ...paths]);
    else await this.git(["rm", "--cached", "--", ...paths]);
  }
  async commit(message: string) {
    if (!bounded(message, "commit message", 10000).trim())
      throw new Error("Enter a commit message.");
    await this.git(["commit", "-m", message]);
  }
  private async clean() {
    if (
      (
        await this.git([
          "status",
          "--porcelain=v1",
          "--untracked-files=all",
          "-z",
        ])
      ).length
    )
      throw new Error(
        "Commit or resolve working tree changes before switching branches or pulling.",
      );
  }
  private async branchName(name: string) {
    bounded(name, "branch name", 200);
    if (name.startsWith("-")) throw new Error("Invalid branch name.");
    await this.git(["check-ref-format", "--branch", name]);
  }
  async switchBranch(name: string) {
    await this.branchName(name);
    const local = (
      await this.git([
        "for-each-ref",
        "--format=%(refname:short)",
        "refs/heads/",
      ])
    )
      .trim()
      .split("\n");
    if (!local.includes(name))
      throw new Error("Select an existing local branch.");
    await this.clean();
    await this.git(["switch", "--", name]);
  }
  async createBranch(name: string) {
    await this.branchName(name);
    await this.clean();
    await this.git(["switch", "-c", name]);
  }
  async sync(action: "fetch" | "pull" | "push", remote: string) {
    if (!["fetch", "pull", "push"].includes(action))
      throw new Error("Invalid Git action.");
    const remotes = (await this.git(["remote"])).trim().split("\n");
    if (!remotes.includes(remote) || remote.startsWith("-"))
      throw new Error("Select a configured remote.");
    if (action === "pull") {
      await this.clean();
      await this.git(["pull", "--ff-only", remote]);
    } else if (action === "fetch") await this.git(["fetch", remote]);
    else {
      const branch = (
        await this.git(["symbolic-ref", "--short", "HEAD"], true)
      ).trim();
      if (!branch) throw new Error("Switch to a branch before pushing.");
      await this.git([
        "push",
        "--set-upstream",
        remote,
        `HEAD:refs/heads/${branch}`,
      ]);
    }
  }
  async setRemote(name: string, url: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name))
      throw new Error(
        "Use letters, numbers, dots, underscores, or hyphens for the remote name.",
      );
    bounded(url, "remote URL", 2048);
    if (!url.trim() || url.startsWith("-") || /[\r\n]/.test(url))
      throw new Error("Invalid remote URL.");
    const remotes = (await this.git(["remote"])).trim().split("\n");
    await this.git([
      "remote",
      remotes.includes(name) ? "set-url" : "add",
      name,
      url,
    ]);
  }
  private async requireCommit(commit: string) {
    if (!/^[a-f0-9]{40,64}$/.test(commit))
      throw new Error("Invalid commit ID.");
    await this.git(["cat-file", "-e", `${commit}^{commit}`]);
  }
  async commitFiles(commit: string) {
    await this.requireCommit(commit);
    return (
      await this.git([
        "diff-tree",
        "--root",
        "--no-commit-id",
        "--name-only",
        "-r",
        // Match diff(), which compares a merge with its first parent.
        "--diff-merges=first-parent",
        "-z",
        commit,
      ])
    )
      .split("\0")
      .filter(Boolean);
  }
}
