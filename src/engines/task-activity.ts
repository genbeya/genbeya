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

/** Text without its outer whitespace, with LF line breaks: Git may convert them on checkout. */
const normalized = (text: string) => text.replace(/\r\n?/g, "\n").trim();

/**
 * Comment texts by author, date and place among the comments with both:
 * dates are to the minute, so one person may write several at once.
 */
function keyed(comments: readonly TaskComment[]): Map<string, string> {
  const seen = new Map<string, number>();
  return new Map(
    comments.map((comment) => {
      const key = `${comment.author}\n${comment.date}`;
      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      return [`${key}\n${count}`, comment.body];
    }),
  );
}

function commentChanges(before: readonly TaskComment[], after: readonly TaskComment[]): TaskChange[] {
  const [old, now] = [keyed(before), keyed(after)];
  const added = [...now.keys()].filter((key) => !old.has(key)).length;
  const edited = [...now].filter(([key, body]) => old.has(key) && old.get(key) !== body).length;
  const removed = [...old.keys()].filter((key) => !now.has(key)).length;
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
  if (normalized(before.description) !== normalized(after.description)) changes.push({ kind: "description" });
  changes.push(...commentChanges(before.comments, after.comments));
  for (const field of changedNames(before.fields, after.fields))
    changes.push({ kind: "custom", field, from: before.fields[field] ?? "", to: after.fields[field] ?? "" });
  const other = changedNames(before.other, after.other);
  if (other.length) changes.push({ kind: "other", fields: other });
  return changes;
}
