/**
 * Plans for pages shown outside Genbeya, such as the copy of the wiki on
 * genbeya.fyi: from a repository's `.genbeya.yml` and task files, what a plan
 * block (`[EFFORT]`, `[DEPENDENCIES]`, `[GANTT]`, `[ARROWS]`, `[FLOAT]`)
 * becomes, as Markdown nodes, exactly as the app draws it (`plan()` of the
 * client's remark plugin). The website's docs sync bundles this module from a
 * release and calls it; the unit tests pin what it returns.
 *
 * Plans over time (`[BURNDOWN]`, `[BASELINE]`) read the tasks' Git history,
 * which files alone don't have: they come back as null, as anything else
 * that isn't a plan block.
 */
import type { RootContent } from "mdast";
import { plan, PLAN } from "../../client/app/markdown/remark-genbeya";
import type { Task } from "../../contracts/model";
import { SettingsEngine } from "../../engines/settings-engine";
import { TaskEngine } from "../../engines/task-engine";
import { planTasks } from "../../utilities/planning";

export interface RepositoryFile {
  /** From the repository's root, with slashes: `tasks/GENBEYA-12.md`. */
  readonly path: string;
  readonly content: string;
}

export interface DocsPlans {
  /** The tasks that could be read; files that aren't tasks are left out. */
  readonly tasks: number;
  /** What `block`, a paragraph's whole text such as `[EFFORT milestone=MVP]`, becomes; null if it isn't a plan block this can draw. */
  draw(block: string): RootContent[] | null;
}

/**
 * Plans of the repository whose settings (the text of `.genbeya.yml`, or null
 * for the defaults) and task files are given, as of `today` (`YYYY-MM-DD`).
 */
export function docsPlans(settingsText: string | null, taskFiles: readonly RepositoryFile[], today: string): DocsPlans {
  const engine = new SettingsEngine();
  const defaults = engine.defaults("");
  const settings = settingsText === null ? defaults : engine.parse(settingsText, defaults, false);
  const parser = new TaskEngine();
  const root = `${settings.taskRoot.replace(/\/+$/, "")}/`;
  const tasks: Task[] = [];
  for (const file of taskFiles) {
    if (!file.path.startsWith(root) || !file.path.endsWith(".md")) continue;
    try {
      tasks.push(parser.parse(file.path, file.content, "", settings.taskRoot));
    } catch {
      // Not a task: a README or a template in the task folder.
    }
  }
  const options = settings.unused.includes("planning")
    ? null
    : {
        tasks: planTasks(tasks),
        statuses: settings.statuses,
        today,
        calendar: { workdays: settings.workdays, holidays: settings.holidays, milestones: settings.milestones },
      };
  return {
    tasks: tasks.length,
    draw(block) {
      const macro = PLAN.exec(block.trim());
      if (!macro || !options) return null;
      return plan(macro[1]!, macro[2] ?? "", options);
    },
  };
}
