/**
 * What's new in each release line, newest first. After an update GitDesk
 * shows the entries the user has not seen; "Show what's new" shows them all.
 * Releases bump the patch with every build, so entries are per `major.minor`.
 * See docs/Development.md for adding one.
 */
import { compareVersions, parseVersion, releaseLine } from "../../../../utilities/version";
import type { TourStep } from "../../ui/tour/tour";

export interface NewsItem {
  readonly title: string;
  /** A sentence or two of Markdown. */
  readonly body: string;
  /** The element the item is about, so "Show me" can point at it; see {@link TourStep}. */
  readonly target?: string;
  readonly route?: string;
}

export interface Release {
  /** The release line, "0.3". */
  readonly version: string;
  readonly items: readonly NewsItem[];
}

export const CHANGELOG: readonly Release[] = [
  {
    version: "0.4",
    items: [
      {
        title: "Reset, publish and force push",
        body: "Right-click a commit in **History** to reset the branch to it, with **Undo** right afterwards. **Publish branch** pushes a new branch and tracks it, **Push to…** pushes anywhere, and a rejected push offers a force push with lease that shows what the remote loses.",
        target: "gd-sync-bar",
        route: "/changes",
      },
      {
        title: "Math and more for engineering docs",
        body: "Pages, tasks and comments typeset LaTeX math (`$…$`, `$$…$$`), give code blocks titles, line numbers and highlighted lines, fold callouts, preview footnotes and show `<kbd>` keys and `<details>` sections. In the editor, `/` at the start of a line inserts blocks.",
      },
    ],
  },
  {
    version: "0.3",
    items: [
      {
        title: "Search inside files",
        body: "`Ctrl+Shift+F`, or `/` at the start of the command palette, finds text in pages, tasks and code, with switches for case, whole words and regular expressions.",
        target: '[data-tour="search"]',
      },
      {
        title: "Task types and templates",
        body: "Mark tasks as bugs, features or types of your own, each with an icon. A new task of a type starts from its template in `tasks/.templates/`. Set them up in **Settings → Task types**.",
        target: '[data-tour="new-task"]',
        route: "/tasks",
      },
      {
        title: "Custom fields",
        body: "Give every task an estimate, a due date or a choice of your own in **Settings → Custom fields**. The values are saved to the task's frontmatter.",
      },
      {
        title: "Comments and activity",
        body: "Discuss a task below its description; comments are stored in the task file. **Activity** shows who changed what, read from Git history.",
        target: '[data-tour="task-board"]',
        route: "/tasks",
      },
      {
        title: "Column icons",
        body: "Pick an icon for each workflow state in **Settings → Workflow**.",
      },
      {
        title: "Links follow moved pages",
        body: "**Move or rename…** in a page's menu updates the links and `[[references]]` that would break, in pages, tasks and other Markdown files.",
        target: '[data-tour="page-header"] [aria-label="Page actions"]',
        route: "/wiki",
      },
      {
        title: "Content where you want it",
        body: "Keep the wiki, the tasks and the settings each in the checkout or on the shared content branch: **Settings → Where content lives**.",
        target: '[data-tour="settings"]',
      },
      {
        title: "Stashes, branches and tags",
        body: "Stash changes from **Changes**. Create, rename and delete branches and tags, and set upstreams, from the menu of a commit in **History**.",
        target: '[data-tour="commit-box"]',
        route: "/changes",
      },
      {
        title: "Merge, rebase and resolve conflicts",
        body: "Merge, rebase (also interactively), cherry-pick and revert from **History**, and resolve conflicts in **Changes**, one conflict or one side at a time.",
        target: '[data-tour="history"]',
        route: "/history",
      },
      {
        title: "A stronger editor",
        body: "Several cursors, a find and replace bar, folding, coloured bracket pairs and a minimap.",
        target: '[data-tour="code-tree"]',
        route: "/code",
      },
      {
        title: "AI agents",
        body: "**Settings → AI agents** adds a skill and instructions that teach Claude Code, Codex, Copilot, Cursor and others to plan in tasks and document in the wiki.",
      },
      {
        title: "Getting started",
        body: "A sample project on the start screen, a guided tour, and these notes after each update. **Settings → Help** has them all, with the version and the documentation.",
        target: '[data-tour="help"]',
        route: "/settings",
      },
      {
        title: "Terminal in the sidebar",
        body: "The terminal has a button in the sidebar now, next to its shortcut.",
        target: '[data-tour="terminal"]',
      },
      {
        title: "Updates install over older versions",
        body: "Every build has a higher version number, so a newer installer replaces the installed version instead of refusing or installing next to it.",
      },
    ],
  },
];

/**
 * The releases up to `current`'s release line, newest first; with `since`,
 * only those after its release line.
 */
export function news(changelog: readonly Release[], current: string, since?: string): Release[] {
  const upTo = parseVersion(current);
  const after = since === undefined ? null : parseVersion(since);
  if (!upTo || (since !== undefined && !after)) return [];
  return changelog.filter((release) => {
    const line = parseVersion(release.version);
    return (
      !!line &&
      compareVersions(line, releaseLine(upTo)) <= 0 &&
      (!after || compareVersions(releaseLine(line), releaseLine(after)) > 0) &&
      release.items.length > 0
    );
  });
}

/** A tour of the news items that point at something. */
export const newsTour = (releases: readonly Release[]): TourStep[] =>
  releases.flatMap((release) =>
    release.items.flatMap((item) => (item.target ? [{ target: item.target, title: item.title, body: item.body, route: item.route }] : [])),
  );
