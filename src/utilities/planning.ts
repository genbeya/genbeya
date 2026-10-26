/**
 * Planning on top of the tasks, derived from their files and never stored:
 * effort (estimate, logged, remaining, forecast, variance), the time log in a
 * task's description, dependencies between tasks, and the charts the wiki's
 * plan macros draw, with the critical path and each task's float. Fields
 * mean their planning meaning by name: `estimate`, `remaining`, `duration`,
 * `start`, `due`, `milestone` and `depends_on`.
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
  duration: "duration",
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

// The schedule: the critical path method over the work that is left.

/** Days as shown: `2d`, `0.5d`. */
export const formatDays = (days: number): string => `${Number(days.toFixed(2))}d`;

const DAY_MS = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

/**
 * How many working days a task still takes, and where that comes from: its
 * `duration` (an effort, `3d` or `12h`), else its `start` to `due` (both
 * days counted), else its remaining effort or estimate at {@link HOURS_PER_DAY}
 * hours a day. Null when it has none of them.
 */
export function durationOf(task: Pick<PlanTask, "fields">): { days: number; from: "duration" | "dates" | "effort" } | null {
  const duration = parseEffort(task.fields[PLANNING_FIELDS.duration]);
  if (duration !== null) return { days: duration / HOURS_PER_DAY, from: "duration" };
  const [start, due] = [String(task.fields[PLANNING_FIELDS.start] ?? ""), String(task.fields[PLANNING_FIELDS.due] ?? "")];
  if (DATE.test(start) && DATE.test(due) && due >= start) return { days: daysBetween(start, due) + 1, from: "dates" };
  const effort = parseEffort(task.fields[PLANNING_FIELDS.remaining]) ?? parseEffort(task.fields[PLANNING_FIELDS.estimate]);
  return effort === null ? null : { days: effort / HOURS_PER_DAY, from: "effort" };
}

/** A task in the schedule, in days from now: day 0 is today. */
export interface ScheduledTask {
  readonly id: string;
  readonly duration: number;
  readonly earlyStart: number;
  readonly earlyFinish: number;
  readonly lateStart: number;
  readonly lateFinish: number;
  /** Total float (slack): how long the task can slip without delaying the end. */
  readonly float: number;
  /** Free float: how long it can slip without delaying any task that waits for it. */
  readonly freeFloat: number;
  /** On the critical path: no float. */
  readonly critical: boolean;
}

export interface Schedule {
  /** The scheduled tasks in an order where each comes after the tasks it waits for. */
  readonly tasks: readonly ScheduledTask[];
  /** Days until the last task finishes. */
  readonly length: number;
  /** Tasks with no duration, dates or effort, counted as taking no time. */
  readonly undetermined: readonly string[];
  /** Tasks left out, being part of a cycle or waiting for one. */
  readonly cyclic: readonly string[];
}

/** Floats this close to zero are zero: fractions of days add up with rounding errors. */
const EPSILON = 1e-9;

/**
 * The critical path method over the unfinished `tasks`: finished tasks are
 * left out, so tasks waiting only for them can start today. Dependencies on
 * tasks outside the set are ignored.
 */
export function scheduleOf(tasks: readonly PlanTask[], dependencies: Dependencies, statuses: readonly string[]): Schedule {
  const open = tasks.filter((task) => task.status !== statuses.at(-1));
  const ids = new Set(open.map((task) => task.id.toUpperCase()));
  const before = (id: string) => (dependencies.waitsFor.get(id) ?? []).filter((other) => ids.has(other));
  const after = (id: string) => (dependencies.blocks.get(id) ?? []).filter((other) => ids.has(other));
  const undetermined: string[] = [];
  const duration = new Map(
    open.map((task) => {
      const days = durationOf(task)?.days ?? null;
      if (days === null) undetermined.push(task.id);
      return [task.id.toUpperCase(), days ?? 0];
    }),
  );
  // Kahn's order; what is never reached waits for a cycle.
  const waiting = new Map([...ids].map((id) => [id, before(id).length]));
  const order: string[] = [...ids].filter((id) => waiting.get(id) === 0);
  // Tasks appended while looping are visited too.
  for (const id of order)
    for (const next of after(id)) {
      waiting.set(next, waiting.get(next)! - 1);
      if (waiting.get(next) === 0) order.push(next);
    }
  const early = new Map<string, number>();
  for (const id of order) early.set(id, Math.max(0, ...before(id).map((other) => early.get(other)! + duration.get(other)!)));
  const length = Math.max(0, ...order.map((id) => early.get(id)! + duration.get(id)!));
  const lateFinish = new Map<string, number>();
  for (const id of [...order].reverse())
    lateFinish.set(id, Math.min(length, ...after(id).map((other) => lateFinish.get(other)! - duration.get(other)!)));
  const scheduled = order.map((id): ScheduledTask => {
    const [earlyStart, days, finish] = [early.get(id)!, duration.get(id)!, lateFinish.get(id)!];
    const float = Math.max(0, finish - days - earlyStart);
    const next = Math.min(length, ...after(id).map((other) => early.get(other)!));
    return {
      id: open.find((task) => task.id.toUpperCase() === id)!.id,
      duration: days,
      earlyStart,
      earlyFinish: earlyStart + days,
      lateStart: finish - days,
      lateFinish: finish,
      float: float < EPSILON ? 0 : float,
      freeFloat: Math.max(0, next - earlyStart - days),
      critical: float < EPSILON,
    };
  });
  const placed = new Set(order);
  return {
    tasks: scheduled,
    length,
    undetermined,
    cyclic: open.filter((task) => !placed.has(task.id.toUpperCase())).map((task) => task.id),
  };
}

/**
 * The schedule as an arrow diagram (activity on arrow): events are circles
 * with their earliest and latest day, tasks are arrows labelled with their
 * duration and float, dummy arrows (dashed) join tasks that share what they
 * wait for, and the critical path is red. Null for an empty schedule.
 */
export function arrowChart(schedule: Schedule, all: readonly PlanTask[], dependencies: Dependencies): string | null {
  if (!schedule.tasks.length) return null;
  const byId = new Map(schedule.tasks.map((task) => [task.id.toUpperCase(), task]));
  const titleOf = new Map(all.map((task) => [task.id.toUpperCase(), task.title]));
  interface Arrow {
    readonly from: number;
    readonly to: number;
    readonly task: ScheduledTask | null;
  }
  let events = 1; // Event 0 is the start.
  const arrows: Arrow[] = [];
  const endOf = new Map<string, number>();
  const merges = new Map<string, number>();
  const finishers: string[] = [];
  for (const task of schedule.tasks) {
    const id = task.id.toUpperCase();
    const waits = (dependencies.waitsFor.get(id) ?? []).filter((other) => byId.has(other));
    let from = 0;
    if (waits.length === 1) from = endOf.get(waits[0]!)!;
    else if (waits.length > 1) {
      // Tasks waiting for the same tasks share one event, reached by dummy arrows.
      const key = [...waits].sort().join(" ");
      if (!merges.has(key)) {
        merges.set(key, events);
        for (const other of waits) arrows.push({ from: endOf.get(other)!, to: events, task: null });
        events++;
      }
      from = merges.get(key)!;
    }
    endOf.set(id, events);
    arrows.push({ from, to: events++, task });
    if (!(dependencies.blocks.get(id) ?? []).some((other) => byId.has(other))) finishers.push(id);
  }
  // The end: one event every last task leads to.
  const end = finishers.length === 1 ? endOf.get(finishers[0]!)! : events++;
  if (finishers.length > 1) for (const id of finishers) arrows.push({ from: endOf.get(id)!, to: end, task: null });
  const earliest = new Array<number>(events).fill(0);
  for (const arrow of arrows) earliest[arrow.to] = Math.max(earliest[arrow.to]!, earliest[arrow.from]! + (arrow.task?.duration ?? 0));
  const latest = new Array<number>(events).fill(schedule.length);
  for (const arrow of [...arrows].reverse())
    latest[arrow.from] = Math.min(latest[arrow.from]!, latest[arrow.to]! - (arrow.task?.duration ?? 0));
  const number = (days: number) => String(Number(days.toFixed(2)));
  const tight = (event: number) => Math.abs(latest[event]! - earliest[event]!) < EPSILON;
  const lines = ["flowchart LR"];
  for (let event = 0; event < events; event++)
    lines.push(`  e${event}(("${number(earliest[event]!)} / ${number(latest[event]!)}"))${tight(event) ? ":::critical" : ""}`);
  const critical: number[] = [];
  arrows.forEach((arrow, index) => {
    const { task } = arrow;
    if (task) {
      const text = label(`${task.id} ${titleOf.get(task.id.toUpperCase()) ?? ""}`);
      const float = task.critical ? "critical" : `float ${formatDays(task.float)}`;
      lines.push(`  e${arrow.from} -->|"${text}<br/>${formatDays(task.duration)} · ${float}"| e${arrow.to}`);
    } else lines.push(`  e${arrow.from} -.-> e${arrow.to}`);
    const onPath = task
      ? task.critical
      : tight(arrow.from) && tight(arrow.to) && Math.abs(earliest[arrow.from]! - earliest[arrow.to]!) < EPSILON;
    if (onPath) critical.push(index);
  });
  lines.push("  classDef critical stroke:#dc2626,stroke-width:2px");
  if (critical.length) lines.push(`  linkStyle ${critical.join(",")} stroke:#dc2626,stroke-width:2.5px`);
  return lines.join("\n");
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
  /** A PlantUML Gantt chart; null when no task can be placed on it. */
  readonly chart: string | null;
  /** Tasks left out: without dates, and without a duration to place them by. */
  readonly undated: number;
  /** Tasks that start before a task they wait for is due. */
  readonly conflicts: readonly string[];
}

/** A task's name in PlantUML, which ends at `]`. */
const ganttName = (text: string) =>
  text
    .replace(/[[\]\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A duration for PlantUML: whole days as days, anything else in hours. */
const ganttDuration = (days: number) => {
  if (Number.isInteger(days) && days > 0) return `${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.max(1, Math.round(days * HOURS_PER_DAY));
  return `${hours} ${hours === 1 ? "hour" : "hours"}`;
};

/**
 * The tasks on a timeline, as a PlantUML Gantt chart: one section per epic,
 * weekends closed, `today` marked. Written dates stay as written: start and
 * due span a task, a due date alone ends it (or makes it a milestone without
 * a duration). Tasks without dates are placed by PlantUML after the tasks
 * they wait for, or from today, for their duration ({@link durationOf}).
 * Arrows join tasks to what they wait for, except for a task that starts
 * before that is due: PlantUML would move it, so the conflict is coloured
 * orange instead. Critical tasks are red; progress is logged / (logged +
 * remaining), finished tasks are complete.
 */
export function timeline(
  tasks: readonly PlanTask[],
  all: readonly PlanTask[],
  dependencies: Dependencies,
  schedule: Schedule,
  statuses: readonly string[],
  today: string,
): Timeline {
  const byId = new Map(all.map((task) => [task.id.toUpperCase(), task]));
  const dateOf = (task: PlanTask | undefined, field: string) => {
    const value = String(task?.fields[field] ?? "");
    return DATE.test(value) ? value : null;
  };
  const done = (task: PlanTask) => task.status === statuses.at(-1);
  const critical = new Set(schedule.tasks.filter((task) => task.critical).map((task) => task.id.toUpperCase()));
  const placed = tasks.filter((task) => {
    const dated = dateOf(task, PLANNING_FIELDS.start) || dateOf(task, PLANNING_FIELDS.due);
    return dated || (!done(task) && durationOf(task) !== null);
  });
  if (!placed.length) return { chart: null, undated: tasks.length, conflicts: [] };
  const alias = new Map(placed.map((task, index) => [task.id.toUpperCase(), `t${index}`]));
  const declarations = new Map<string, string[]>();
  const constraints: string[] = [];
  const conflicts: string[] = [];
  const dates = [today];
  for (const task of placed) {
    const id = task.id.toUpperCase();
    const name = `[${ganttName(`${task.id} ${task.title}`)}] as [${alias.get(id)}]`;
    const [start, due] = [dateOf(task, PLANNING_FIELDS.start), dateOf(task, PLANNING_FIELDS.due)];
    const days = durationOf(task)?.days ?? null;
    dates.push(...[start, due].filter((date): date is string => date !== null));
    const waits = (dependencies.waitsFor.get(id) ?? []).filter((other) => alias.has(other));
    let line: string;
    if (start && due && due >= start) line = `${name} starts ${start} and ends ${due}`;
    else if (due) line = days === null ? `${name} happens ${due}` : `${name} requires ${ganttDuration(days)} and ends ${due}`;
    else if (start) line = `${name} starts ${start} and requires ${ganttDuration(days ?? 1)}`;
    else line = `${name} requires ${ganttDuration(days!)}`;
    // Undated work that waits for nothing unfinished starts today, not in the past; a start date wins over arrows.
    if (!start && !due && waits.every((other) => done(byId.get(other)!))) constraints.push(`[${alias.get(id)}] starts ${today}`);
    const late = waits.filter((other) => {
      const before = dateOf(byId.get(other), PLANNING_FIELDS.due);
      return start !== null && before !== null && before >= start;
    });
    if (late.length) conflicts.push(task.id);
    for (const other of waits) if (!late.includes(other)) constraints.push(`[${alias.get(other)}] -> [${alias.get(id)}]`);
    const effort = effortOf(task, done(task));
    const progress = done(task) ? 100 : effort.logged > 0 && effort.forecast ? Math.round((100 * effort.logged) / effort.forecast) : 0;
    if (progress) constraints.push(`[${alias.get(id)}] is ${progress}% completed`);
    if (late.length) constraints.push(`[${alias.get(id)}] is colored in #fed7aa/#ea580c`);
    else if (critical.has(id)) constraints.push(`[${alias.get(id)}] is colored in #fecaca/#dc2626`);
    const section = task.epic || "No epic";
    declarations.set(section, [...(declarations.get(section) ?? []), line]);
  }
  const lines = [
    "@startgantt",
    `Project starts ${dates.sort()[0]}`,
    "saturday are closed",
    "sunday are closed",
    `today is ${today} and is colored in #fef3c7`,
  ];
  for (const [section, entries] of declarations) lines.push(`-- ${ganttName(section)} --`, ...entries);
  lines.push(...constraints, "@endgantt");
  return { chart: lines.join("\n"), undated: tasks.length - placed.length, conflicts };
}
