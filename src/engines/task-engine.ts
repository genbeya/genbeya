/**
 * The task file format: one Markdown file per task with YAML frontmatter
/**
 * The task file format: one Markdown file per task with YAML frontmatter
 * (`id`, `title`, `status`, optional `type`, `priority`, `assignee`, `labels`,
 * and custom fields), the description, then the comments (see
 * task-comments.ts). Updates rewrite known fields in place, so comments and
 * fields other tools added survive, and keep the file's byte order mark and
 * line endings.
 *
 * Templates for new tasks of a type live in `<taskRoot>/.templates/<type>.md`:
 * their description, and frontmatter that presets fields. Folders whose names
 * start with a dot hold no tasks.
 */
import YAML from "yaml";
import { TASK_KEYS, type FieldValue, type Task, type TaskChange, type TaskInput, type TaskTemplate } from "../contracts/model";
import { validateRepositoryPath, within } from "../utilities/repository-path";
import { applyTextStyle, LF_STYLE, textStyleOf, withoutByteOrderMark } from "../utilities/text-style";
import { diffTasks, type TaskState } from "./task-activity";
import { commentBlock, commentHeading, joinComments, protectHeadings, splitComments, timestampOf, type SplitBody } from "./task-comments";

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const DEFAULT_PRIORITY = "none";
const TEMPLATE_FOLDER = ".templates";
const LIMITS = {
  title: 300,
  type: 40,
  priority: 40,
  assignee: 120,
  label: 60,
  labels: 30,
  body: 1024 * 1024,
  epic: 120,
  fields: 50,
  field: 100,
  value: 2000,
  comment: 64 * 1024,
} as const;
/** Keys a field must not have: GitDesk's own, and names that would reach object prototypes. */
const NOT_FIELDS: readonly string[] = [...TASK_KEYS, "__proto__", "constructor", "prototype"];

/** A version of a task file at `path`; null content when Git did not show it (a move without edits). */
export interface TaskVersion {
  readonly path: string;
  readonly content: string | null;
}

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

const isFieldValue = (value: unknown): value is FieldValue =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/** Frontmatter fields other than GitDesk's own that hold a plain value. */
const extraFields = (data: Record<string, unknown>): Record<string, FieldValue> =>
  Object.fromEntries(
    Object.entries(data).filter((entry): entry is [string, FieldValue] => !NOT_FIELDS.includes(entry[0]) && isFieldValue(entry[1])),
  );

/**
 * Frontmatter fields in their written order; empty or default optional fields
 * are left out, and the type is only there when the input has one.
 */
const fieldsOf = (input: TaskInput) => ({
  title: input.title,
  ...(input.type !== undefined && { type: input.type || undefined }),
  status: input.status,
  priority: input.priority === DEFAULT_PRIORITY ? undefined : input.priority,
  assignee: input.assignee || undefined,
  labels: input.labels.length ? [...input.labels] : undefined,
});

/** Flow lists keep the usual spelling, [a, b]. */
const yamlText = (document: YAML.Document) => document.toString({ flowCollectionPadding: false });

const compose = (frontmatter: string, body: string) => `---\n${frontmatter}---\n\n${body.replace(/^\s*\n/, "").trimEnd()}\n`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class TaskEngine {
  /** `path` is the task file below `taskRoot`; its folder there is the task's epic. */
  parse(path: string, content: string, hash: string, taskRoot: string): Task {
    const { data, body } = splitFrontmatter(content);
    if (data["id"] == null || data["title"] == null || data["status"] == null)
      throw new Error("A task needs id, title and status in its frontmatter.");
    const { description, blocks } = splitComments(body.replace(/^\r?\n/, ""));
    return {
      id: String(data["id"]),
      path,
      title: String(data["title"]),
      status: String(data["status"]),
      priority: String(data["priority"] ?? DEFAULT_PRIORITY),
      assignee: String(data["assignee"] ?? ""),
      labels: toList(data["labels"]),
      type: String(data["type"] ?? ""),
      fields: extraFields(data),
      body: description,
      epic: this.epicOf(path, taskRoot),
      hash,
      comments: blocks.map((block) => block.comment),
    };
  }

  /** Markdown files below the task folder, outside folders whose names start with a dot. */
  isTaskFile(path: string, taskRoot: string): boolean {
    return (
      within(path, taskRoot) &&
      path.toLowerCase().endsWith(".md") &&
      !path
        .slice(taskRoot.length + 1)
        .split("/")
        .some((part) => part.startsWith("."))
    );
  }

  templatePath(taskRoot: string, type: unknown): string {
    if (typeof type !== "string" || !type.trim() || type.length > LIMITS.type || /[/\\]|^\./.test(type))
      throw new Error("Invalid task type.");
    return `${taskRoot}/${TEMPLATE_FOLDER}/${type}.md`;
  }

  /** The description of a template, and the fields its frontmatter presets (not id, title, type or status). */
  parseTemplate(content: string): TaskTemplate {
    const { data, body } = splitFrontmatter(content);
    const fields = extraFields(data);
    return {
      body: body.replace(/^\r?\n/, ""),
      ...(data["priority"] != null && { priority: String(data["priority"]) }),
      ...(data["assignee"] != null && { assignee: String(data["assignee"]) }),
      ...(data["labels"] != null && { labels: toList(data["labels"]) }),
      ...(Object.keys(fields).length && { fields }),
    };
  }

  /** A first template for a type, to edit in GitDesk. */
  newTemplate(type: string): string {
    return [
      "---",
      `# New ${type} tasks start with the description below. Fields here, such as`,
      "# priority, assignee, labels or custom fields, preset theirs too.",
      "---",
      "",
      "## Context",
      "",
      "## Done when",
      "",
    ].join("\n");
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
      body: protectHeadings(text(input.body, "description", LIMITS.body)),
      epic: this.validEpic(input.epic),
      ...(input.type !== undefined && {
        type: text(input.type, "type", LIMITS.type)
          .replace(/[\r\n]+/g, " ")
          .trim(),
      }),
      ...(input.fields !== undefined && { fields: this.validFields(input.fields) }),
    };
  }

  /** "" or a folder path such as "Auth/Tokens"; spaces around the slashes are dropped. */
  private validEpic(value: unknown): string {
    if (typeof value !== "string" || value.length > LIMITS.epic) throw new Error("Invalid epic.");
    const parts = value
      .split("/")
      .map((part) => part.trim())
      .filter(Boolean);
    const epic = parts.join("/");
    if (!epic) return "";
    try {
      // Folders starting with a dot hold no tasks.
      if (parts.some((part) => part.startsWith("."))) throw new Error();
      return validateRepositoryPath(epic, false);
    } catch {
      throw new Error(`"${epic}" is not a valid epic name.`);
    }
  }

  private validFields(value: unknown): Record<string, FieldValue> {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length > LIMITS.fields)
      throw new Error("Invalid fields.");
    for (const [key, field] of Object.entries(value)) {
      if (!key || key.length > LIMITS.field || NOT_FIELDS.includes(key)) throw new Error(`Invalid field ${key}.`);
      if (!isFieldValue(field) || (typeof field === "string" && field.length > LIMITS.value)) throw new Error(`Invalid value of ${key}.`);
    }
    return { ...(value as Record<string, FieldValue>) };
  }

  serializeNew(id: string, input: TaskInput): string {
    const fields = Object.entries(input.fields ?? {}).filter(([, value]) => value !== "");
    const document = new YAML.Document({ id, ...fieldsOf(input), ...Object.fromEntries(fields) });
    return applyTextStyle(compose(yamlText(document), input.body), LF_STYLE);
  }

  /**
   * `original` with the fields and description of `input`; its comments stay
   * as they are, and so do fields that `input` does not name.
   */
  serializeUpdate(original: string, input: TaskInput): string {
    const { document, body } = splitFrontmatter(original);
    for (const [key, value] of Object.entries(fieldsOf(input))) {
      if (value === undefined) document.delete(key);
      else document.set(key, value);
    }
    for (const [key, value] of Object.entries(input.fields ?? {})) {
      if (value === "") document.delete(key);
      else if (document.get(key) !== value) document.set(key, value);
    }
    const comments = splitComments(body.replace(/^\r?\n/, "")).blocks.map((block) => block.text);
    return applyTextStyle(compose(yamlText(document), joinComments(input.body, comments)), textStyleOf(original));
  }

  /** A comment's text, checked and normalised. */
  validComment(value: unknown): string {
    if (typeof value !== "string" || value.length > LIMITS.comment) throw new Error("Invalid comment.");
    const text = value.replace(/\r\n?/g, "\n").trim();
    if (!text) throw new Error("Write a comment first.");
    return protectHeadings(text);
  }

  /** A person's name as comments are signed with it: one line, bounded. */
  commentAuthor(name: string): string {
    return name.replace(/\s+/g, " ").trim().slice(0, LIMITS.assignee);
  }

  /** `original` with a comment by `author`, written at `date`, after the others. */
  addComment(original: string, author: string, date: Date, text: string): string {
    const heading = commentHeading(this.commentAuthor(author), timestampOf(date));
    return this.withComments(original, ({ blocks }) => [...blocks.map((block) => block.text), commentBlock(heading, text)]);
  }

  /** `original` with the text of comment `index` replaced; its author and date stay. */
  editComment(original: string, index: number, text: string): string {
    return this.withComments(
      original,
      ({ blocks }) => blocks.map((block, i) => (i === index ? commentBlock(block.heading, text) : block.text)),
      index,
    );
  }

  removeComment(original: string, index: number): string {
    return this.withComments(original, ({ blocks }) => blocks.filter((_, i) => i !== index).map((block) => block.text), index);
  }

  /**
   * `original` with the comment texts `change` makes of its comments; the
   * frontmatter and description stay as written. `index` must name a comment.
   */
  private withComments(original: string, change: (body: SplitBody) => string[], index?: number): string {
    const raw = withoutByteOrderMark(original);
    const frontmatter = FRONTMATTER.exec(raw);
    if (!frontmatter) throw new Error("A task needs id, title and status in its frontmatter.");
    const body = splitComments(raw.slice(frontmatter[0].length).replace(/^\r?\n/, ""));
    if (index !== undefined && !body.blocks[index])
      throw new Error("This comment no longer exists. Reopen the task to see the latest version.");
    const text = joinComments(body.description, change(body));
    return applyTextStyle(`${frontmatter[0].trimEnd()}\n${text && `\n${text}`}`, textStyleOf(original));
  }

  /** What changed about a task from `before` (null: it did not exist) to `after`. */
  changesBetween(before: TaskVersion | null, after: TaskVersion, taskRoot: string): TaskChange[] {
    if (before?.content == null || after.content === null) {
      if (!before) return [{ kind: "created" }];
      const [from, to] = [this.epicOf(before.path, taskRoot), this.epicOf(after.path, taskRoot)];
      return from === to ? [] : [{ kind: "field", field: "epic", from, to }];
    }
    return diffTasks(this.stateOf(before.path, before.content, taskRoot), this.stateOf(after.path, after.content, taskRoot));
  }

  /** A version of a task as its activity sees it; broken frontmatter reads as empty. */
  private stateOf(path: string, content: string, taskRoot: string): TaskState {
    let data: Record<string, unknown> = {};
    let body = content;
    try {
      ({ data, body } = splitFrontmatter(content));
    } catch {
      // Old versions may be broken; their body still counts.
    }
    const { description, blocks } = splitComments(body.replace(/^\r?\n/, ""));
    const text = (key: string, fallback = "") => String(data[key] ?? fallback);
    const fields = extraFields(data);
    return {
      title: text("title"),
      type: text("type"),
      status: text("status"),
      priority: text("priority", DEFAULT_PRIORITY),
      assignee: text("assignee"),
      epic: this.epicOf(path, taskRoot),
      labels: toList(data["labels"]),
      description,
      comments: blocks.map((block) => block.comment),
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, String(value)])),
      other: Object.fromEntries(
        Object.entries(data)
          .filter(([key]) => !NOT_FIELDS.includes(key) && !Object.hasOwn(fields, key))
          .map(([key, value]) => [key, JSON.stringify(value)]),
      ),
    };
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
