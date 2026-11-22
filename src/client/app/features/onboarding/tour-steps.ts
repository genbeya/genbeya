/** The guided tour of Genbeya. Its elements carry `data-tour` attributes; the share step finds the page's menu button. */
import { shownParts, type Part } from "../../../../contracts/model";
import type { TourStep } from "../../ui/tour/tour";

/** How the platform names the modifiers ("⌘" and "⌃" on macOS). */
export interface Keys {
  readonly mod: string;
  readonly ctrl: string;
}

const at = (name: string) => `[data-tour="${name}"]`;

/** The part each step shows, by its route or target; steps of hidden parts are left out. */
const STEP_PARTS: Readonly<Record<string, Part>> = { terminal: "terminal", "page-header": "wiki" };

const partOf = (step: TourStep): Part | null => {
  const view = step.route?.slice(1);
  const name = /data-tour="([^"]+)"/.exec(step.target)?.[1] ?? "";
  return STEP_PARTS[name] ?? ((view as Part | undefined) || null);
};

/** The tour of the parts that show; it starts in `home`, the first view that does. */
export function appTour({ mod, ctrl }: Keys, shown: ReadonlySet<Part> = shownParts([]), home = "wiki"): TourStep[] {
  const steps: TourStep[] = [
    {
      target: at("views"),
      route: `/${home}`,
      placement: "right",
      title: "One repository, six views",
      body: `Wiki, tasks, code, changes, history and pull requests of the open repository. \`${mod}+1\` to \`${mod}+6\` switch between them; **Settings** turns off the ones you don't use.`,
    },
    {
      target: at("repositories"),
      placement: "right",
      title: "Repositories",
      body: "Open a folder, a repository on WSL or over SSH with a folder browser, or clone one. Recent repositories are listed here too.",
    },
    {
      target: at("wiki-tree"),
      route: "/wiki",
      placement: "right",
      title: "The wiki",
      body: "Pages are Markdown files in the wiki folder, `docs/` unless `.genbeya.yml` names another. A folder named like a page holds its subpages.",
    },
    {
      target: at("wiki-edit"),
      route: "/wiki",
      placement: "bottom",
      title: "Write pages",
      body: "The editor shows a live preview. Type `[[` to link a page, task or file; `![[src/app.ts#L1-L9]]` on its own line embeds those lines. Mermaid and PlantUML diagrams render too.",
      tryIt: "Press E to edit this page",
    },
    {
      target: at("task-board"),
      route: "/tasks",
      placement: "left",
      title: "Tasks",
      body: "Each task is a Markdown file in `tasks/`. Drag cards between columns to change their state. A folder below `tasks/` is an epic.",
    },
    {
      target: at("new-task"),
      route: "/tasks",
      placement: "bottom",
      title: "New task",
      body: "New tasks are numbered with the project's prefix, such as `PRJ-12`. Write `[[PRJ-12]]` anywhere to show the task's title and state.",
      tryIt: "Press C to create a task",
    },
    {
      target: at("task-layout"),
      route: "/tasks",
      placement: "bottom",
      title: "Board or list",
      body: "The list shows every task. Untick a state there to hide its column from the board. With epics, the swimlane button shows a row per epic.",
    },
    {
      target: at("code-tree"),
      route: "/code",
      placement: "right",
      title: "Code",
      body: "Every file of the repository, with an editor. `.genbeya.yml` at the root holds the settings everyone shares.",
    },
    {
      target: at("commit-box"),
      route: "/changes",
      placement: "right",
      title: "Changes",
      body: `Edits to code, pages and tasks are ordinary changes. Stage them, write a message and commit with \`${mod}+Enter\`. Fetch, pull and push are right below.`,
    },
    {
      target: at("history"),
      route: "/history",
      placement: "right",
      title: "History",
      body: "Every branch with its commit graph. Select a commit to see its message and files.",
    },
    {
      target: at("branch"),
      placement: "right",
      title: "Branches",
      body: "Switch branches, check out a remote one or create one.",
    },
    {
      target: at("terminal"),
      placement: "right",
      title: "Terminal",
      body: `A shell in the repository, on the machine it lives on: this computer, WSL or an SSH server. \`\` ${ctrl}+\` \`\` shows and hides it.`,
    },
    {
      target: at("search"),
      placement: "right",
      title: "Search and commands",
      body: "Find pages, tasks and files, and run commands. Paste a Genbeya link to open what it points at.",
      tryIt: `Press ${mod}+K`,
    },
    {
      target: at("settings"),
      placement: "right",
      title: "Settings",
      body: "The project's settings, saved to `.genbeya.yml`. The wiki, the tasks and the settings can each live on a content branch that every code branch shares. **Help** has the version and the documentation.",
    },
    {
      target: `${at("page-header")} [aria-label="Page actions"]`,
      route: "/wiki",
      placement: "bottom",
      title: "Share",
      body: "Copy a link that opens this page in a coworker's Genbeya, or on GitHub, GitLab, Bitbucket or Azure DevOps. Right-click any page, task, file or commit for the same. To see this tour again, run **Start the tour** from the command palette.",
    },
  ];
  return steps.filter((step) => {
    const part = partOf(step);
    return !part || part === home || shown.has(part);
  });
}
