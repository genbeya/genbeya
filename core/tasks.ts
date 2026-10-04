import YAML from "yaml";
import type { Task, TaskInput } from "../shared/api.js";

const FRONTMATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(raw: string) {
  const match = FRONTMATTER.exec(raw);
  const document = YAML.parseDocument(match?.[1] ?? "");
  if (document.errors.length)
    throw new Error("Invalid YAML frontmatter: " + document.errors[0].message);
  const data = document.toJS() ?? {};
  if (typeof data !== "object" || Array.isArray(data))
    throw new Error("Frontmatter must be a YAML mapping.");
  return { document, data: data as Record<string, unknown>, body: match ? raw.slice(match[0].length) : raw };
}

const list = (value: unknown) =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === "string"
      ? value.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

export function parseTask(path: string, content: string, hash: string): Task {
  const { data, body } = splitFrontmatter(content);
  if (data.id == null || data.title == null || data.status == null)
    throw new Error("A task needs id, title and status in its frontmatter.");
  return {
    id: String(data.id),
    path,
    title: String(data.title),
    status: String(data.status),
    priority: String(data.priority ?? "none"),
    assignee: String(data.assignee ?? ""),
    labels: list(data.labels),
    body: body.replace(/^\r?\n/, ""),
    hash,
  };
}

export function validateTaskInput(input: TaskInput, statuses: string[]): TaskInput {
  const text = (v: unknown, label: string, max: number) => {
    if (typeof v !== "string" || v.length > max) throw new Error(`Invalid ${label}.`);
    return v;
  };
  const title = text(input.title, "title", 300).replace(/[\r\n]+/g, " ").trim();
  if (!title) throw new Error("A task needs a title.");
  if (!statuses.includes(input.status)) throw new Error("Choose one of the configured workflow states.");
  if (!Array.isArray(input.labels) || input.labels.length > 30) throw new Error("Use at most 30 labels.");
  return {
    title,
    status: input.status,
    priority: text(input.priority, "priority", 40).trim() || "none",
    assignee: text(input.assignee, "assignee", 120).trim(),
    labels: [...new Set(input.labels.map((l) => text(l, "label", 60).trim()).filter(Boolean))],
    body: text(input.body, "description", 1024 * 1024),
  };
}

const fields = (input: TaskInput) => ({
  title: input.title,
  status: input.status,
  priority: input.priority,
  assignee: input.assignee || undefined,
  labels: input.labels.length ? input.labels : undefined,
});

const compose = (frontmatter: string, body: string) =>
  `---\n${frontmatter}---\n\n${body.replace(/^\s*\n/, "").replace(/\s*$/, "\n")}`;

export function serializeNewTask(id: string, input: TaskInput) {
  const document = new YAML.Document({ id, ...fields(input) });
  return compose(document.toString(), input.body);
}

/** Rewrites known fields in place; comments and unknown fields survive. */
export function serializeTaskUpdate(original: string, input: TaskInput) {
  const { document } = splitFrontmatter(original);
  for (const [key, value] of Object.entries(fields(input))) {
    if (value === undefined) document.delete(key);
    else document.set(key, value);
  }
  return compose(document.toString(), input.body);
}

/** Next `PREFIX-n` id, one past the highest existing number for that prefix. */
export function nextTaskId(prefix: string, ids: Iterable<string>) {
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let highest = 0;
  for (const id of ids) {
    const match = pattern.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${prefix}-${highest + 1}`;
}
