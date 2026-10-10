/**
 * The task file format: one Markdown file per task with YAML frontmatter
 * (`id`, `title`, `status`, optional `priority`, `assignee`, `labels`).
 * Updates rewrite known fields in place, so comments and fields other tools
 * added survive, and keep the file's byte order mark and line endings.
 */
import YAML from "yaml";
import type { Task, TaskInput } from "../contracts/model";
import { validateRepositoryPath, within } from "../utilities/repository-path";
import { applyTextStyle, LF_STYLE, textStyleOf, withoutByteOrderMark } from "../utilities/text-style";

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const DEFAULT_PRIORITY = "none";
const LIMITS = { title: 300, priority: 40, assignee: 120, label: 60, labels: 30, body: 1024 * 1024, epic: 120 } as const;

interface Frontmatter {
  readonly document: YAML.Document;
  readonly data: Record<string, unknown>;
  readonly body: string;
}

function splitFrontmatter(file: string): Frontmatter {
  const raw = withoutByteOrderMark(file);
  const match = FRONTMATTER.exec(raw);
  const document = YAML.parseDocument(match?.[1] ?? "");
  if (document.errors.length) throw new Error(`Invalid YAML frontmatter: ${document.errors[0]!.message}`);
  const data: unknown = document.toJS() ?? {};
  if (typeof data !== "object" || Array.isArray(data)) throw new Error("Frontmatter must be a YAML mapping.");
  return { document, data: data as Record<string, unknown>, body: match ? raw.slice(match[0].length) : raw };
}

const toList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

/** Frontmatter fields in their written order; empty or default optional fields are left out. */
const fieldsOf = (input: TaskInput) => ({
  title: input.title,
  status: input.status,
  priority: input.priority === DEFAULT_PRIORITY ? undefined : input.priority,
  assignee: input.assignee || undefined,
  labels: input.labels.length ? [...input.labels] : undefined,
});

const compose = (frontmatter: string, body: string) => `---\n${frontmatter}---\n\n${body.replace(/^\s*\n/, "").trimEnd()}\n`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class TaskEngine {
  /** `path` is the task file below `taskRoot`; its folder there is the task's epic. */
  parse(path: string, content: string, hash: string, taskRoot: string): Task {
    const { data, body } = splitFrontmatter(content);
    if (data["id"] == null || data["title"] == null || data["status"] == null)
      throw new Error("A task needs id, title and status in its frontmatter.");
    return {
      id: String(data["id"]),
      path,
      title: String(data["title"]),
      status: String(data["status"]),
      priority: String(data["priority"] ?? DEFAULT_PRIORITY),
      assignee: String(data["assignee"] ?? ""),
      labels: toList(data["labels"]),
      body: body.replace(/^\r?\n/, ""),
      epic: this.epicOf(path, taskRoot),
      hash,
    };
  }

  epicOf(path: string, taskRoot: string): string {
    if (!within(path, taskRoot)) return "";
    const below = path.slice(taskRoot.length + 1);
    return below.includes("/") ? below.slice(0, below.lastIndexOf("/")) : "";
  }

  /**
   * `epic` spelled like the existing epic folders among `files` that differ from it only in
   * case, folder by folder: Windows and macOS see one folder in both spellings.
   */
  existingSpelling(epic: string, files: readonly string[], taskRoot: string): string {
    const folders = new Map<string, string>();
    for (const file of files) {
      const parts = this.epicOf(file, taskRoot).split("/");
      for (let length = 1; length <= parts.length && parts[0]; length++) {
        const folder = parts.slice(0, length).join("/");
        if (!folders.has(folder.toLowerCase())) folders.set(folder.toLowerCase(), folder);
      }
    }
    let spelled = "";
    for (const part of epic ? epic.split("/") : []) {
      const folder = spelled ? `${spelled}/${part}` : part;
      spelled = folders.get(folder.toLowerCase()) ?? folder;
    }
    return spelled;
  }

  /** Where the task `id` of `epic` lives. */
  pathOf(taskRoot: string, epic: string, id: string): string {
    return [taskRoot, ...(epic ? [epic] : []), `${id}.md`].join("/");
  }

  /** Checks and normalises client input against the project's workflow states. */
  validate(input: TaskInput, statuses: readonly string[]): TaskInput {
    const text = (value: unknown, label: string, max: number) => {
      if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${label}.`);
      return value;
    };
    const title = text(input.title, "title", LIMITS.title)
      .replace(/[\r\n]+/g, " ")
      .trim();
    if (!title) throw new Error("A task needs a title.");
    if (!statuses.includes(input.status)) throw new Error("Choose one of the configured workflow states.");
    if (!Array.isArray(input.labels) || input.labels.length > LIMITS.labels) throw new Error("Use at most 30 labels.");
    return {
      title,
      status: input.status,
      priority: text(input.priority, "priority", LIMITS.priority).trim() || DEFAULT_PRIORITY,
      assignee: text(input.assignee, "assignee", LIMITS.assignee).trim(),
      labels: [...new Set(input.labels.map((label) => text(label, "label", LIMITS.label).trim()).filter(Boolean))],
      body: text(input.body, "description", LIMITS.body),
      epic: this.validEpic(input.epic),
    };
  }

  /** "" or a folder path such as "Auth/Tokens"; spaces around the slashes are dropped. */
  private validEpic(value: unknown): string {
    if (typeof value !== "string" || value.length > LIMITS.epic) throw new Error("Invalid epic.");
    const epic = value
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean)
      .join("/");
    if (!epic) return "";
    try {
      return validateRepositoryPath(epic, false);
    } catch {
      throw new Error(`"${epic}" is not a valid epic name.`);
    }
  }

  serializeNew(id: string, input: TaskInput): string {
    return applyTextStyle(compose(new YAML.Document({ id, ...fieldsOf(input) }).toString(), input.body), LF_STYLE);
  }

  serializeUpdate(original: string, input: TaskInput): string {
    const { document } = splitFrontmatter(original);
    for (const [key, value] of Object.entries(fieldsOf(input))) {
      if (value === undefined) document.delete(key);
      else document.set(key, value);
    }
    return applyTextStyle(compose(document.toString(), input.body), textStyleOf(original));
  }

  /**
   * `PREFIX-n`, one past the highest number used with the prefix. `taken`
   * reports IDs whose file names exist although no task claims them (for
   * example a task renamed on another branch).
   */
  nextId(prefix: string, ids: Iterable<string>, taken: (id: string) => boolean = () => false): string {
    const pattern = new RegExp(`^${escapeRegExp(prefix)}-(\\d+)$`, "i");
    let highest = 0;
    for (const id of ids) {
      const match = pattern.exec(id);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
    let id: string;
    do id = `${prefix}-${++highest}`;
    while (taken(id));
    return id;
  }
}
