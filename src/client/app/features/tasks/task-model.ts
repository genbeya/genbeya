/** How tasks are ordered, filtered, grouped and labelled on the board and list. */
import { PRIORITIES, type Task, type TaskInput } from "../../../../contracts/model";
import { statusTone } from "../../ui/status-tone";

export interface TaskFilters {
  readonly query: string;
  /** An assignee, "-" for unassigned, or null for everyone. */
  readonly assignee: string | null;
  readonly label: string | null;
  readonly priority: string | null;
  /** An epic, "" for tasks without one, or null for all. */
  readonly epic: string | null;
}

/** Where a dragged card goes while its move is saved. */
export interface Placement {
  readonly status: string;
  readonly epic: string;
}

export const NO_FILTERS: TaskFilters = { query: "", assignee: null, label: null, priority: null, epic: null };
export const UNASSIGNED = "-";

export const titleCase = (text: string): string => text.replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

/** The CSS colour of a state; see {@link statusTone}. */
export function statusColor(index: number, count: number): string {
  const tone = statusTone(index, count);
  return tone === "other" ? "var(--text-3)" : `var(--${tone})`;
}

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

/** Tasks matching the filters, sorted; `moving` shows dragged tasks in their new place while saving. */
export function visibleTasks(tasks: readonly Task[], filters: TaskFilters, moving: ReadonlyMap<string, Placement> = new Map()): Task[] {
  const query = filters.query.trim().toLowerCase();
  return tasks
    .map((task) => (moving.has(task.path) ? { ...task, ...moving.get(task.path)! } : task))
    .filter(
      (task) =>
        (!query || [task.id, task.title, task.assignee, ...task.labels].join(" ").toLowerCase().includes(query)) &&
        (!filters.assignee || task.assignee === filters.assignee || (filters.assignee === UNASSIGNED && !task.assignee)) &&
        (!filters.label || task.labels.includes(filters.label)) &&
        (!filters.priority || task.priority === filters.priority) &&
        (filters.epic === null || task.epic === filters.epic),
    )
    .sort(compareTasks);
}

/** The configured states, then any other states tasks are in (shown so they can be moved out). */
export const columnsOf = (statuses: readonly string[], tasks: readonly Task[]): string[] => [
  ...statuses,
  ...new Set(tasks.map((task) => task.status).filter((status) => !statuses.includes(status))),
];

export const peopleOf = (tasks: readonly Task[]): string[] => [...new Set(tasks.map((task) => task.assignee).filter(Boolean))].sort();

export const labelsOf = (tasks: readonly Task[]): string[] => [...new Set(tasks.flatMap((task) => task.labels))].sort();

/** Epics that hold tasks, sorted; tasks without one are not an epic. */
export const epicsOf = (tasks: readonly Task[]): string[] =>
  [...new Set(tasks.map((task) => task.epic).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

/** Swimlanes: every epic, then the tasks without one. */
export const lanesOf = (tasks: readonly Task[]): string[] => [...epicsOf(tasks), ""];
