/**
 * Planning on top of the tasks, derived from their files and never stored:
 * effort (estimate, logged, remaining, forecast, variance), the time log in a
 * task's description, dependencies between tasks, and the charts the wiki's
 * plan macros draw. Fields mean their planning meaning by name: `estimate`,
 * `remaining`, `start`, `due`, `milestone` and `depends_on`.
 */
import type { FieldValue, Task } from "../contracts/model";

/** Days of effort count as this many hours. */
export const HOURS_PER_DAY = 8;

/** The fields planning reads, by their well-known names. */
export const PLANNING_FIELDS = {
  estimate: "estimate",
  remaining: "remaining",
  start: "start",
  due: "due",
  milestone: "milestone",
  dependsOn: "depends_on",
} as const;

/** A task as planning sees it: its properties, and the hours its time log adds up to. */
export interface PlanTask {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly status: string;
  readonly epic: string;
  readonly assignee: string;
  readonly labels: readonly string[];
  readonly type: string;
  readonly fields: Readonly<Record<string, FieldValue>>;
  /** Hours logged in the task's time log. */
  readonly logged: number;
  /** Lines of the time log that are no entry. */
  readonly unreadable: number;
}

/** Tasks as planning sees them, their time logs added up. */
export const planTasks = (tasks: readonly Task[]): PlanTask[] =>
  tasks.map(({ id, path, title, status, epic, assignee, labels, type, fields, body }) => {
    const log = timeLogOf(body);
    return { id, path, title, status, epic, assignee, labels, type, fields, logged: log.total, unreadable: log.unreadable.length };
  });

// Effort.

const EFFORT = /^\s*(\d+(?:\.\d+)?)\s*([hd])?\s*$/i;

/** Hours of an effort: `16h`, `2d` (a day is {@link HOURS_PER_DAY} hours) or a number of hours; null for anything else. */
export function parseEffort(value: FieldValue | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const match = typeof value === "string" ? EFFORT.exec(value) : null;
  if (!match) return null;
  return Number(match[1]) * (match[2]?.toLowerCase() === "d" ? HOURS_PER_DAY : 1);
}

/** Hours as written in effort fields and the time log: `12.5h`. */
export const formatEffort = (hours: number): string => `${Number(hours.toFixed(2))}h`;

/** A difference in hours, signed: `+2h`, `−3.5h`, `0h`. */
export const formatVariance = (hours: number): string =>
  hours > 0 ? `+${formatEffort(hours)}` : hours < 0 ? `−${formatEffort(-hours)}` : formatEffort(0);

export interface Effort {
  /** The original budget; null without an estimate. */
  readonly estimate: number | null;
  /** What the time log adds up to. */
  readonly logged: number;
  /** The effort still needed; null when unknown. A finished task needs none. */
  readonly remaining: number | null;
  /** Logged + remaining: where the task will land; null without a remaining effort. */
  readonly forecast: number | null;
  /** Forecast − estimate: above the budget when positive; null when either is unknown. */
  readonly variance: number | null;
}

/** The effort of a task. Remaining is never estimate − logged: work grows and shrinks as it is found. */
export function effortOf(task: Pick<PlanTask, "fields" | "logged">, done: boolean): Effort {
  const estimate = parseEffort(task.fields[PLANNING_FIELDS.estimate]);
  const remaining = parseEffort(task.fields[PLANNING_FIELDS.remaining]) ?? (done ? 0 : null);
  const forecast = remaining === null ? null : task.logged + remaining;
  return {
    estimate,
    logged: task.logged,
    remaining,
    forecast,
    variance: forecast === null || estimate === null ? null : forecast - estimate,
  };
}

// The time log.

/** One line of a time log: who spent how much on what, when. */
export interface TimeEntry {
  /** `YYYY-MM-DD`. */
  readonly date: string;
  readonly author: string;
  readonly hours: number;
  readonly note: string;
}

export interface TimeLog {
  readonly entries: readonly TimeEntry[];
  /** List items of the section that are no entry, as written: they count as missing data. */
  readonly unreadable: readonly string[];
  /** Hours of all entries. */
  readonly total: number;
}

const TIME_LOG = /^##\s+Time log\s*$/i;
const SECTION_END = /^#{1,2}\s/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*[-*+]\s+/;
/** `- 2026-10-21 — Alex — 2h — Investigated the OAuth flow`; dashes of any width, spaced. */
const ENTRY = /^\s*[-*+]\s+(\d{4}-\d{2}-\d{2})\s+[—–-]\s+(.+?)\s+[—–-]\s+(\d+(?:\.\d+)?\s*[hd]?)(?:\s+[—–-]\s+(.*?))?\s*$/i;

/** Whether each line is inside a fenced code block, fences included. */
function fencedLines(lines: readonly string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const marker = FENCE.exec(line)?.[1];
    if (!marker) return fence !== null;
    if (!fence) fence = marker;
    else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    return true;
  });
}

/**
 * The `## Time log` section of a description, from its heading to the next
 * heading of level 1 or 2, and the lines of its entries: list items outside
 * code blocks.
 */
function timeLogSection(lines: readonly string[]): { start: number; end: number; items: number[] } | null {
  const fenced = fencedLines(lines);
  const start = lines.findIndex((line, i) => !fenced[i] && TIME_LOG.test(line));
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && !fenced[i] && SECTION_END.test(line));
  if (end < 0) end = lines.length;
  const items: number[] = [];
  for (let i = start + 1; i < end; i++) if (!fenced[i] && LIST_ITEM.test(lines[i]!)) items.push(i);
  return { start, end, items };
}

/** The time log of a task's description: a `## Time log` section with one list item per entry. */
export function timeLogOf(body: string): TimeLog {
  const lines = body.split(/\r?\n/);
  const entries: TimeEntry[] = [];
  const unreadable: string[] = [];
  for (const index of timeLogSection(lines)?.items ?? []) {
    const line = lines[index]!;
    const match = ENTRY.exec(line);
    const hours = match ? parseEffort(match[3]) : null;
    if (!match || hours === null) unreadable.push(line.trim());
    else entries.push({ date: match[1]!, author: match[2]!, hours, note: match[4] ?? "" });
  }
  return { entries, unreadable, total: entries.reduce((sum, entry) => sum + entry.hours, 0) };
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** An entry as a line of the time log. */
export const timeEntryLine = ({ date, author, hours, note }: TimeEntry): string =>
  `- ${date} — ${oneLine(author)} — ${formatEffort(hours)}${oneLine(note) ? ` — ${oneLine(note)}` : ""}`;

/** The description with `entry` after the last entry of its time log, which is added at its end when it has none. */
export function addTimeEntry(body: string, entry: TimeEntry): string {
  const newline = body.includes("\r\n") ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);
  const section = timeLogSection(lines);
  if (!section) {
    const text = body.trimEnd();
    return `${text}${text ? newline + newline : ""}## Time log${newline}${newline}${timeEntryLine(entry)}${newline}`;
  }
  const last = section.items.at(-1);
  // The first entry goes below the heading, after a blank line.
  const added =
    last === undefined
      ? [...lines.slice(0, section.start + 1), "", timeEntryLine(entry), ...lines.slice(section.start + 1)]
      : [...lines.slice(0, last + 1), timeEntryLine(entry), ...lines.slice(last + 1)];
  return added.join(newline);
}

// Dependencies.

/** The task IDs a task depends on, upper case: a list, or IDs separated by commas or spaces. */
export function dependsOn(fields: Readonly<Record<string, FieldValue>>): string[] {
  const value = fields[PLANNING_FIELDS.dependsOn];
  const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\s,]+/) : [];
  return [...new Set(items.map((item) => item.trim().toUpperCase()).filter(Boolean))];
}

/** Where a task stands among its dependencies. */
export type DependencyState = "blocked" | "ready" | "done";

export interface Dependencies {
  /** The known tasks each task waits for, by ID. */
  readonly waitsFor: ReadonlyMap<string, readonly string[]>;
  /** The tasks that wait for each task, by ID. */
  readonly blocks: ReadonlyMap<string, readonly string[]>;
  /** What is wrong with a task's dependencies: unknown tasks, itself, cycles. */
  readonly problems: ReadonlyMap<string, readonly string[]>;
  /** Tasks with dependencies: blocked while one is unfinished, ready once all are done; done tasks are done. */
  readonly states: ReadonlyMap<string, DependencyState>;
}

/** Finish-to-start dependencies between `tasks`; the last workflow state is done. */
export function dependenciesOf(tasks: readonly Pick<PlanTask, "id" | "status" | "fields">[], statuses: readonly string[]): Dependencies {
  const byId = new Map(tasks.map((task) => [task.id.toUpperCase(), task]));
  const done = (id: string) => byId.get(id)?.status === statuses.at(-1);
  const waitsFor = new Map<string, string[]>();
  const blocks = new Map<string, string[]>();
  const problems = new Map<string, string[]>();
  const problem = (id: string, text: string) => problems.set(id, [...(problems.get(id) ?? []), text]);
  for (const task of tasks) {
    const id = task.id.toUpperCase();
    const known: string[] = [];
    for (const other of dependsOn(task.fields)) {
      if (other === id) problem(id, "depends on itself");
      else if (!byId.has(other)) problem(id, `depends on ${other}, which doesn't exist`);
      else known.push(other);
    }
    if (!known.length) continue;
    waitsFor.set(id, known);
    for (const other of known) blocks.set(other, [...(blocks.get(other) ?? []), id]);
  }
  for (const cycle of cyclesOf(waitsFor)) for (const id of cycle) problem(id, `is part of a cycle: ${[...cycle, cycle[0]].join(" → ")}`);
  const states = new Map<string, DependencyState>();
  for (const [id, others] of waitsFor) states.set(id, done(id) ? "done" : others.every(done) ? "ready" : "blocked");
  return { waitsFor, blocks, problems, states };
}

/** Each cycle once, from its first task in the order of `edges`. */
function cyclesOf(edges: ReadonlyMap<string, readonly string[]>): string[][] {
  const cycles: string[][] = [];
  const finished = new Set<string>();
  const path: string[] = [];
  const visit = (id: string) => {
    const at = path.indexOf(id);
    if (at >= 0) return void cycles.push(path.slice(at));
    if (finished.has(id)) return;
    path.push(id);
    for (const next of edges.get(id) ?? []) visit(next);
    path.pop();
    finished.add(id);
  };
  for (const id of edges.keys()) visit(id);
  return cycles;
}

// The wiki's plan macros.

/** Which tasks a plan macro shows: `epic`, `milestone`, `assignee`, `label`, `type`, `status`, all to match. */
export type PlanFilter = Readonly<Record<string, string>>;

const FILTER_KEYS = new Set(["epic", "milestone", "assignee", "label", "type", "status"]);
const FILTER = /(\w+)\s*=\s*(?:"([^"]*)"|(\S+))/g;

/** `epic="2 Planning" milestone=MVP` as a filter; keys it doesn't know are left out. */
export function parseFilter(text: string): PlanFilter {
  return Object.fromEntries(
    [...text.matchAll(FILTER)].filter((m) => FILTER_KEYS.has(m[1]!.toLowerCase())).map((m) => [m[1]!.toLowerCase(), m[2] ?? m[3]!]),
  );
}

/** Whether a task matches a filter; an epic also matches the epics inside it. Case does not matter. */
export function matchesFilter(task: PlanTask, filter: PlanFilter): boolean {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  return Object.entries(filter).every(([key, value]) => {
    switch (key) {
      case "epic":
        return same(task.epic, value) || task.epic.toLowerCase().startsWith(`${value.toLowerCase()}/`);
      case "milestone":
        return same(String(task.fields[PLANNING_FIELDS.milestone] ?? ""), value);
      case "label":
        return task.labels.some((label) => same(label, value));
      case "assignee":
      case "type":
      case "status":
        return same(task[key], value);
      default:
        return true;
    }
  });
}

/** Text for a Mermaid label, without the characters that end one or start markup. */
const label = (text: string) => text.replace(/["<>]/g, "'").replace(/[:;#]/g, " ").replace(/\s+/g, " ").trim();

/**
 * A Mermaid flowchart of the dependencies among `tasks`: each task that waits
 * for or blocks another, and the tasks it waits for, an arrow from blocker to
 * blocked. Null when none of them has a dependency.
 */
export function dependencyChart(
  tasks: readonly PlanTask[],
  all: readonly PlanTask[],
  dependencies: Dependencies,
  statuses: readonly string[],
): string | null {
  const byId = new Map(all.map((task) => [task.id.toUpperCase(), task]));
  const shown = new Set<string>();
  for (const task of tasks) {
    const id = task.id.toUpperCase();
    const waits = dependencies.waitsFor.get(id) ?? [];
    if (!waits.length && !dependencies.blocks.get(id)?.length) continue;
    shown.add(id);
    for (const other of waits) shown.add(other);
  }
  if (!shown.size) return null;
  const ids = [...shown];
  const node = (id: string) => `t${ids.indexOf(id)}`;
  const lines = ["flowchart LR"];
  for (const id of ids) {
    const task = byId.get(id)!;
    // Tasks without dependencies of their own are only marked when done.
    const state = dependencies.states.get(id) ?? (task.status === statuses.at(-1) ? "done" : null);
    lines.push(`  ${node(id)}["${label(`${task.id} ${task.title}`)}"]${state ? `:::${state}` : ""}`);
  }
  for (const id of ids)
    for (const other of dependencies.waitsFor.get(id) ?? []) if (shown.has(other)) lines.push(`  ${node(other)} --> ${node(id)}`);
  lines.push(
    "  classDef done stroke:#2f9e5b,stroke-width:2px",
    "  classDef ready stroke:#3b82f6,stroke-width:2px",
    "  classDef blocked stroke:#d97706,stroke-width:2px,stroke-dasharray:4 3",
  );
  return lines.join("\n");
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface Timeline {
  /** A Mermaid Gantt chart; null when no task has dates. */
  readonly chart: string | null;
  /** Tasks left out for want of a start and a due date. */
  readonly undated: number;
  /** Tasks that start before a task they wait for is due. */
  readonly conflicts: readonly string[];
}

/**
 * The tasks with a start and a due date as a Mermaid Gantt chart, one section
 * per epic. Done tasks show as done, a task that starts before one it waits
 * for is due is critical. A task with only a due date is a milestone.
 */
export function timeline(
  tasks: readonly PlanTask[],
  all: readonly PlanTask[],
  dependencies: Dependencies,
  statuses: readonly string[],
): Timeline {
  const byId = new Map(all.map((task) => [task.id.toUpperCase(), task]));
  const dateOf = (task: PlanTask | undefined, field: string) => {
    const value = String(task?.fields[field] ?? "");
    return DATE.test(value) ? value : null;
  };
  const dated = tasks.filter((task) => dateOf(task, PLANNING_FIELDS.due));
  const conflicts: string[] = [];
  const sections = new Map<string, string[]>();
  dated.forEach((task, index) => {
    const [start, due] = [dateOf(task, PLANNING_FIELDS.start), dateOf(task, PLANNING_FIELDS.due)!];
    const late = start
      ? (dependencies.waitsFor.get(task.id.toUpperCase()) ?? []).some((other) => {
          const before = dateOf(byId.get(other), PLANNING_FIELDS.due);
          return before !== null && before > start;
        })
      : false;
    if (late) conflicts.push(task.id);
    const tags = [task.status === statuses.at(-1) ? "done" : "", late ? "crit" : "", start ? "" : "milestone"].filter(Boolean);
    const span = start && start <= due ? `${start}, ${due}` : `${due}, 0d`;
    const line = `  ${label(`${task.id} ${task.title}`)} :${[...tags, `t${index}`].join(", ")}, ${span}`;
    const section = task.epic || "No epic";
    sections.set(section, [...(sections.get(section) ?? []), line]);
  });
  if (!dated.length) return { chart: null, undated: tasks.length, conflicts };
  const lines = ["gantt", "  dateFormat YYYY-MM-DD", "  axisFormat %d %b"];
  for (const [section, entries] of sections) lines.push(`  section ${label(section)}`, ...entries);
  return { chart: lines.join("\n"), undated: tasks.length - dated.length, conflicts };
}
