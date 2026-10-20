/** How tasks are ordered, filtered, grouped and labelled on the board and list. */
import { GENERIC_TYPE_ICON, PRIORITIES, type Task, type TaskInput, type TaskType, type Tone } from "../../../../contracts/model";
import { statusTone } from "../../ui/status-tone";

export interface TaskFilters {
  readonly query: string;
  /** An assignee, "-" for unassigned, or null for everyone. */
  readonly assignee: string | null;
  readonly label: string | null;
  readonly priority: string | null;
  /** An epic, "" for tasks without one, or null for all. */
  readonly epic: string | null;
  /** A task type, "" for tasks without one, or null for all. */
  readonly type: string | null;
}

/** Where a dragged card goes while its move is saved. */
export interface Placement {
  readonly status: string;
  readonly epic: string;
}

export const NO_FILTERS: TaskFilters = { query: "", assignee: null, label: null, priority: null, epic: null, type: null };
export const UNASSIGNED = "-";

export const titleCase = (text: string): string => text.replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

/** The CSS colour of a state; see {@link statusTone}. */
export function statusColor(index: number, count: number): string {
  const tone = statusTone(index, count);
  return tone === "other" ? "var(--text-3)" : `var(--${tone})`;
}

/** The CSS colour of a task type's tone; types without one are grey text. */
export const toneColor = (tone: Tone | undefined): string => (tone ? `var(--${tone})` : "var(--text-2)");

/** The configured type of this name, or the generic look of a type that is not configured. */
export const typeLook = (name: string, types: readonly TaskType[]): TaskType =>
  types.find((type) => type.name === name) ?? { name, icon: GENERIC_TYPE_ICON };

const priorityRank = (priority: string): number => {
  const index = (PRIORITIES as readonly string[]).indexOf(priority);
  return index < 0 ? PRIORITIES.length : index;
};

const numberOf = (id: string): number => Number(/(\d+)$/.exec(id)?.[1] ?? 0);

/** Highest priority first, then the newest numbered task. */
export const compareTasks = (a: Task, b: Task): number =>
  priorityRank(a.priority) - priorityRank(b.priority) || numberOf(b.id) - numberOf(a.id) || a.title.localeCompare(b.title);

export const inputOf = (task: Task): TaskInput => ({
  title: task.title,
  status: task.status,
  priority: task.priority,
  assignee: task.assignee,
  labels: task.labels,
  type: task.type,
  fields: task.fields,
  body: task.body,
  epic: task.epic,
});

/** An epic's name for people: its folder path, or "No epic". */
export const epicName = (epic: string): string => epic || "No epic";

/** Generated UUIDs are shortened; readable IDs are shown whole. */
export const displayId = (id: string): string => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id);

const LABEL_HUES = [250, 160, 25, 210, 320, 45, 280, 185];
export function labelColor(label: string): string {
  let hash = 0;
  for (const character of label) hash = (hash * 33 + character.charCodeAt(0)) | 0;
  return `hsl(${LABEL_HUES[Math.abs(hash) % LABEL_HUES.length]} 65% 60%)`;
}

/** Who an assignee is: the same for every way of writing them, such as a person's handle for their name. */
export type Identify = (assignee: string) => string;
const asWritten: Identify = (assignee) => assignee;

/**
 * Tasks matching the filters, sorted; `moving` shows dragged tasks in their new place while saving.
 * An assignee filter finds the person however tasks write them.
 */
export function visibleTasks(
  tasks: readonly Task[],
  filters: TaskFilters,
  moving: ReadonlyMap<string, Placement> = new Map(),
  identify: Identify = asWritten,
): Task[] {
  const assignee = filters.assignee && filters.assignee !== UNASSIGNED ? identify(filters.assignee) : null;
  const query = filters.query.trim().toLowerCase();
  return tasks
    .map((task) => (moving.has(task.path) ? { ...task, ...moving.get(task.path)! } : task))
    .filter(
      (task) =>
        (!query || [task.id, task.title, task.assignee, ...task.labels].join(" ").toLowerCase().includes(query)) &&
        (!filters.assignee ||
          (assignee !== null && !!task.assignee && identify(task.assignee) === assignee) ||
          (filters.assignee === UNASSIGNED && !task.assignee)) &&
        (!filters.label || task.labels.includes(filters.label)) &&
        (!filters.priority || task.priority === filters.priority) &&
        (filters.epic === null || task.epic === filters.epic) &&
        (filters.type === null || task.type === filters.type),
    )
    .sort(compareTasks);
}

/** The configured states, then any other states tasks are in (shown so they can be moved out). */
export const columnsOf = (statuses: readonly string[], tasks: readonly Task[]): string[] => [
  ...statuses,
  ...new Set(tasks.map((task) => task.status).filter((status) => !statuses.includes(status))),
];

/** The assignees of tasks, once per person. */
export const peopleOf = (tasks: readonly Task[], identify: Identify = asWritten): string[] =>
  [
    ...new Set(
      tasks
        .map((task) => task.assignee)
        .filter(Boolean)
        .map(identify),
    ),
  ].sort();

export const labelsOf = (tasks: readonly Task[]): string[] => [...new Set(tasks.flatMap((task) => task.labels))].sort();

/** Epics that hold tasks, sorted; tasks without one are not an epic. */
export const epicsOf = (tasks: readonly Task[]): string[] =>
  [...new Set(tasks.map((task) => task.epic).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

/** The configured types, then other types that tasks have. */
export const typesOf = (types: readonly TaskType[], tasks: readonly Pick<Task, "type">[]): TaskType[] => [
  ...types,
  ...[...new Set(tasks.map((task) => task.type))]
    .filter((name) => name && !types.some((type) => type.name === name))
    .sort()
    .map((name) => typeLook(name, types)),
];

/** Swimlanes: every epic, then the tasks without one. */
export const lanesOf = (tasks: readonly Task[]): string[] => [...epicsOf(tasks), ""];

/**
 * The swimlanes a board shows for the cards it shows (`tasks`, filtered, in
 * `columns`): no lane stays empty because of a filter or a hidden column.
 */
export const shownLanesOf = (tasks: readonly Task[], columns: readonly string[]): string[] => {
  const shown = tasks.filter((task) => columns.includes(task.status));
  return [...epicsOf(shown), ...(shown.some((task) => !task.epic) ? [""] : [])];
};
