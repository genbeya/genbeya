/**
 * The task file format: one Markdown file per task with YAML frontmatter
 * (`id`, `title`, `status`, optional `priority`, `assignee`, `labels`).
 * Updates rewrite known fields in place, so comments and fields other tools
 * added survive.
 */
import YAML from "yaml";
import type { Task, TaskInput } from "../contracts/model";

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const LIMITS = { title: 300, priority: 40, assignee: 120, label: 60, labels: 30, body: 1024 * 1024 } as const;

interface Frontmatter {
  readonly document: YAML.Document;
  readonly data: Record<string, unknown>;
  readonly body: string;
}

function splitFrontmatter(raw: string): Frontmatter {
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
      ? value.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

/** Frontmatter fields in their written order; empty optional fields are left out. */
const fieldsOf = (input: TaskInput) => ({
  title: input.title,
  status: input.status,
  priority: input.priority,
  assignee: input.assignee || undefined,
  labels: input.labels.length ? [...input.labels] : undefined,
});

const compose = (frontmatter: string, body: string) =>
  `---\n${frontmatter}---\n\n${body.replace(/^\s*\n/, "").replace(/\s*$/, "\n")}`;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class TaskEngine {
  parse(path: string, content: string, hash: string): Task {
    const { data, body } = splitFrontmatter(content);
    if (data["id"] == null || data["title"] == null || data["status"] == null)
      throw new Error("A task needs id, title and status in its frontmatter.");
    return {
      id: String(data["id"]),
      path,
      title: String(data["title"]),
      status: String(data["status"]),
      priority: String(data["priority"] ?? "none"),
      assignee: String(data["assignee"] ?? ""),
      labels: toList(data["labels"]),
      body: body.replace(/^\r?\n/, ""),
      hash,
    };
  }

  /** Checks and normalises client input against the project's workflow states. */
  validate(input: TaskInput, statuses: readonly string[]): TaskInput {
    const text = (value: unknown, label: string, max: number) => {
      if (typeof value !== "string" || value.length > max) throw new Error(`Invalid ${label}.`);
      return value;
    };
    const title = text(input.title, "title", LIMITS.title).replace(/[\r\n]+/g, " ").trim();
    if (!title) throw new Error("A task needs a title.");
    if (!statuses.includes(input.status)) throw new Error("Choose one of the configured workflow states.");
    if (!Array.isArray(input.labels) || input.labels.length > LIMITS.labels) throw new Error("Use at most 30 labels.");
    return {
      title,
      status: input.status,
      priority: text(input.priority, "priority", LIMITS.priority).trim() || "none",
      assignee: text(input.assignee, "assignee", LIMITS.assignee).trim(),
      labels: [...new Set(input.labels.map((label) => text(label, "label", LIMITS.label).trim()).filter(Boolean))],
      body: text(input.body, "description", LIMITS.body),
    };
  }

  serializeNew(id: string, input: TaskInput): string {
    return compose(new YAML.Document({ id, ...fieldsOf(input) }).toString(), input.body);
  }

  serializeUpdate(original: string, input: TaskInput): string {
    const { document } = splitFrontmatter(original);
    for (const [key, value] of Object.entries(fieldsOf(input))) {
      if (value === undefined) document.delete(key);
      else document.set(key, value);
    }
    return compose(document.toString(), input.body);
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
