/** Tasks as plans see them, from versions of their files; shared by the workspace's managers and the web demo's. */
import type { PlanVersion } from "../contracts/model";
import type { TaskEngine } from "../engines/task-engine";
import { planTasks } from "../utilities/planning";

/** History reaches back this many commits that changed tasks. */
export const PLAN_HISTORY_LIMIT = 300;

/** The version of each task file; a file that is no task (any more) reads as none. */
export function planVersions(
  files: readonly { readonly path: string; readonly content: string | null }[],
  engine: TaskEngine,
  taskRoot: string,
): { path: string; task: PlanVersion | null }[] {
  return files
    .filter((file) => engine.isTaskFile(file.path, taskRoot))
    .map((file) => {
      if (file.content === null) return { path: file.path, task: null };
      try {
        return { path: file.path, task: planTasks([engine.parse(file.path, file.content, "", taskRoot)])[0]! };
      } catch {
        return { path: file.path, task: null };
      }
    });
}
