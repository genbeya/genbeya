/**
 * The plan over time, from the tasks' committed history: remaining and
 * logged effort day by day for a burn chart, and what changed since a
 * baseline, with the commit and the person who changed it. Nothing is
 * stored: Git has every version of every task.
 */
import type { PlanHistory, PlanVersion } from "../contracts/model";
import { dependsOn, effortOf, formatEffort, formatVariance, matchesFilter, PLANNING_FIELDS, type PlanFilter } from "./planning";

export interface BurnPoint {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  /** Hours still to do of the matching unfinished tasks. */
  readonly remaining: number;
  /** Hours logged on the matching tasks so far. */
  readonly logged: number;
}

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/** Each day's last state of the matching tasks: the commits oldest first, then today's tasks, uncommitted edits included. */
export function burnDown(
  history: PlanHistory,
  current: readonly PlanVersion[],
  filter: PlanFilter,
  statuses: readonly string[],
  today: string,
): BurnPoint[] {
  const done = statuses.at(-1);
  const state = new Map<string, PlanVersion>();
  const points = new Map<string, BurnPoint>();
  const record = (date: string, tasks: Iterable<PlanVersion>) => {
    const shown = [...tasks].filter((task) => matchesFilter(task, filter));
    points.set(date, {
      date,
      // A finished task has nothing left, whatever its field still says.
      remaining: sum(shown.map((task) => (task.status === done ? 0 : (effortOf(task, false).remaining ?? 0)))),
      logged: sum(shown.map((task) => task.logged)),
    });
  };
  for (const commit of [...history.commits].reverse()) {
    for (const { path, task } of commit.tasks) {
      if (task) state.set(path, task);
      else state.delete(path);
    }
    record(commit.date.slice(0, 10), state.values());
  }
  record(today, current);
  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** A burn chart as Mermaid: remaining effort as bars, logged effort as a line, the last `days` points. */
export function burnChart(points: readonly BurnPoint[], days = 30): string | null {
  const shown = points.slice(-days);
  if (shown.length < 2) return null;
  const hours = (value: number) => Number(value.toFixed(1));
  const top = Math.max(1, ...shown.map((point) => Math.max(point.remaining, point.logged)));
  return [
    "xychart-beta",
    `  x-axis [${shown.map((point) => `"${point.date.slice(5)}"`).join(", ")}]`,
    `  y-axis "Hours" 0 --> ${Math.ceil(top * 1.1)}`,
    `  bar [${shown.map((point) => hours(point.remaining)).join(", ")}]`,
    `  line [${shown.map((point) => hours(point.logged)).join(", ")}]`,
  ].join("\n");
}

export interface BaselineRow {
  readonly id: string;
  readonly title: string;
  /** What changed, in words: "added", "estimate 8h → 16h", "due 2026-11-10 → 2026-11-20". */
  readonly changes: readonly string[];
  /** The last commit after the baseline that changed the task; null for edits not committed yet. */
  readonly commit: { readonly hash: string; readonly author: string; readonly date: string } | null;
}

export interface BaselineComparison {
  readonly rows: readonly BaselineRow[];
  /** Estimate and forecast of the matching tasks, at the baseline and now, in hours. */
  readonly estimate: { readonly before: number; readonly after: number };
  readonly forecast: { readonly before: number; readonly after: number };
}

const text = (task: PlanVersion, field: string) => {
  const value = task.fields[field];
  return value === undefined || value === null ? "" : Array.isArray(value) ? value.join(", ") : String(value);
};

/** How a task differs from its version at the baseline. */
function differences(before: PlanVersion | undefined, after: PlanVersion | undefined): string[] {
  if (!before) return ["added"];
  if (!after) return ["removed"];
  const changes: string[] = [];
  for (const field of [
    PLANNING_FIELDS.estimate,
    PLANNING_FIELDS.start,
    PLANNING_FIELDS.due,
    PLANNING_FIELDS.milestone,
    PLANNING_FIELDS.duration,
  ]) {
    const [from, to] = [text(before, field), text(after, field)];
    if (from !== to) changes.push(`${field} ${from || "none"} → ${to || "none"}`);
  }
  const [waited, waits] = [dependsOn(before.fields), dependsOn(after.fields)];
  const added = waits.filter((id) => !waited.includes(id));
  const removed = waited.filter((id) => !waits.includes(id));
  if (added.length || removed.length)
    changes.push(`waits for ${[...added.map((id) => `+${id}`), ...removed.map((id) => `−${id}`)].join(" ")}`);
  return changes;
}

/**
 * The matching tasks that differ from the baseline: added, removed, or with
 * estimates, dates, milestones or dependencies changed, each with the last
 * commit after the baseline that changed it.
 */
export function baselineComparison(
  history: PlanHistory,
  current: readonly PlanVersion[],
  filter: PlanFilter,
  statuses: readonly string[],
): BaselineComparison {
  const baseline = history.baseline?.tasks ?? [];
  const done = statuses.at(-1);
  const byId = (tasks: readonly PlanVersion[]) =>
    new Map(tasks.filter((task) => matchesFilter(task, filter)).map((task) => [task.id.toUpperCase(), task]));
  const [before, after] = [byId(baseline), byId(current)];
  const since = history.baseline?.date ?? null;
  // Commits after the baseline, newest first, by the IDs of the tasks they changed.
  const lastChange = new Map<string, BaselineRow["commit"]>();
  for (const commit of history.commits) {
    if (commit.commit === history.baseline?.commit || (since !== null && Date.parse(commit.date) <= Date.parse(since))) continue;
    for (const { task, path } of commit.tasks) {
      const id = (task?.id ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "")).toUpperCase();
      if (!lastChange.has(id)) lastChange.set(id, { hash: commit.commit, author: commit.author, date: commit.date });
    }
  }
  const rows: BaselineRow[] = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const changes = differences(before.get(id), after.get(id));
    if (!changes.length) continue;
    const task = after.get(id) ?? before.get(id)!;
    rows.push({ id: task.id, title: task.title, changes, commit: lastChange.get(id) ?? null });
  }
  const total = (tasks: Map<string, PlanVersion>, pick: (task: PlanVersion) => number | null) =>
    sum([...tasks.values()].map((task) => pick(task) ?? 0));
  return {
    rows,
    estimate: {
      before: total(before, (task) => effortOf(task, task.status === done).estimate),
      after: total(after, (task) => effortOf(task, task.status === done).estimate),
    },
    forecast: {
      before: total(before, (task) => effortOf(task, task.status === done).forecast),
      after: total(after, (task) => effortOf(task, task.status === done).forecast),
    },
  };
}

/** The comparison as Markdown: a sentence on the totals, and a table of the changed tasks. */
export function baselineMarkdown(comparison: BaselineComparison, revision: string): string {
  const { estimate, forecast, rows } = comparison;
  const moved = (label: string, { before, after }: { before: number; after: number }) =>
    `${label} ${formatEffort(before)} at ${revision}, ${formatEffort(after)} now${after !== before ? ` (${formatVariance(after - before)})` : ""}`;
  const lines = [`${moved("Estimate", estimate)}; ${moved("forecast", forecast)}.`, ""];
  if (!rows.length) return [...lines, `No task changed its plan since ${revision}.`].join("\n");
  lines.push("| Task | Changes | Changed by |", "| --- | --- | --- |");
  for (const row of rows)
    lines.push(
      `| [[${row.id}]] | ${row.changes.join("; ").replace(/\|/g, "\\|")} | ${row.commit ? `${row.commit.author}, ${row.commit.date.slice(0, 10)}, \`${row.commit.hash.slice(0, 7)}\`` : "not committed yet"} |`,
    );
  return lines.join("\n");
}
