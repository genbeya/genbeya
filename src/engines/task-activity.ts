/** What changed about a task between two versions of its file, for its activity. */
import type { TaskChange, TaskComment, TaskField } from "../contracts/model";

/** A version of a task as far as its activity is concerned. */
export interface TaskState {
  readonly title: string;
  readonly type: string;
  readonly status: string;
  readonly priority: string;
  readonly assignee: string;
  readonly epic: string;
  readonly labels: readonly string[];
  readonly description: string;
  readonly comments: readonly TaskComment[];
  /** Custom fields with a plain value, by name, as text. */
  readonly fields: Readonly<Record<string, string>>;
  /** Other frontmatter fields, by name, as JSON. */
  readonly other: Readonly<Record<string, string>>;
}

const FIELDS: readonly TaskField[] = ["title", "type", "status", "priority", "assignee", "epic"];

/** The names of the entries that differ between `before` and `after`, sorted. */
const changedNames = (before: Readonly<Record<string, string>>, after: Readonly<Record<string, string>>): string[] =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().filter((name) => before[name] !== after[name]);

const keyOf = (comment: TaskComment) => `${comment.author}\n${comment.date}`;

function commentChanges(before: readonly TaskComment[], after: readonly TaskComment[]): TaskChange[] {
  const old = new Map(before.map((comment) => [keyOf(comment), comment.body]));
  const kept = new Set(after.map(keyOf));
  const added = after.filter((comment) => !old.has(keyOf(comment))).length;
  const edited = after.filter((comment) => old.has(keyOf(comment)) && old.get(keyOf(comment)) !== comment.body).length;
  const removed = before.filter((comment) => !kept.has(keyOf(comment))).length;
  return added || edited || removed ? [{ kind: "comments", added, edited, removed }] : [];
}

/** The changes from `before` to `after`; a task without a `before` was created. */
export function diffTasks(before: TaskState | null, after: TaskState): TaskChange[] {
  if (!before) return [{ kind: "created" }];
  const changes: TaskChange[] = FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    kind: "field",
    field,
    from: before[field],
    to: after[field],
  }));
  const added = after.labels.filter((label) => !before.labels.includes(label));
  const removed = before.labels.filter((label) => !after.labels.includes(label));
  if (added.length || removed.length) changes.push({ kind: "labels", added, removed });
  if (before.description.trim() !== after.description.trim()) changes.push({ kind: "description" });
  changes.push(...commentChanges(before.comments, after.comments));
  for (const field of changedNames(before.fields, after.fields))
    changes.push({ kind: "custom", field, from: before.fields[field] ?? "", to: after.fields[field] ?? "" });
  const other = changedNames(before.other, after.other);
  if (other.length) changes.push({ kind: "other", fields: other });
  return changes;
}
