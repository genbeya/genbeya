/** The tasks view's board: one group per workflow state, in the order of the settings. */
import type { Settings, Task, TaskInput } from "../../contracts/model";

export interface TaskGroup {
  readonly status: string;
  readonly tasks: readonly Task[];
  /** Hidden columns and the last state (done) start collapsed, like the board leaves them out or at the end. */
  readonly collapsed: boolean;
}

const idNumber = (id: string) => Number(/(\d+)$/.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER);

/**
 * Every configured state gets a group, empty ones too, so tasks can be
 * dropped there; states that only tasks name (a typo, a removed state)
 * follow, so no task goes missing. Within a group, tasks are by ID.
 */
export function groupTasks(tasks: readonly Task[], settings: Pick<Settings, "statuses" | "hiddenColumns">): TaskGroup[] {
  const extra = [...new Set(tasks.map((task) => task.status))].filter((status) => !settings.statuses.includes(status));
  const last = settings.statuses.at(-1);
  return [...settings.statuses, ...extra].map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status).sort((a, b) => idNumber(a.id) - idNumber(b.id) || a.id.localeCompare(b.id)),
    collapsed: status === last || settings.hiddenColumns.includes(status),
  }));
}

/** What updating `task` to another state sends: everything else as it is. */
export const withStatus = (task: Task, status: string): TaskInput => ({
  title: task.title,
  status,
  priority: task.priority,
  assignee: task.assignee,
  labels: task.labels,
  body: task.body,
  epic: task.epic,
  type: task.type,
  fields: task.fields,
});
