/**
 * What's new in each release line, newest first. After an update Genbeya
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
  /** The release line, "0.1". */
  readonly version: string;
  readonly items: readonly NewsItem[];
}

export const CHANGELOG: readonly Release[] = [
  {
    version: "0.2",
    items: [
      {
        title: "Pull requests",
        body: "Ask for a review of a branch in **Pull requests** (`Ctrl+6`). The review, the discussion and the verdicts are a Markdown file in the repository. Open the first one with **New pull request** in `Ctrl+K`.",
      },
      {
        title: "Plan with your tasks",
        body: "Give tasks an estimate, the remaining effort, dates and what they wait for, and log time. `[GANTT]`, `[FLOAT]` and `[BURNDOWN]` on a page draw the timeline, the critical path and a burn chart.",
      },
      {
        title: "Only the parts you use",
        body: "Turn the wiki, the board, planning and other parts off for the project or just for you, in **Settings**. Planning, the time log and pull requests show by themselves once the project uses them.",
      },
      {
        title: "References pinned to a revision",
        body: "`#L10-L20@v0.1.0` after a file reference shows the lines as they were in that tag or commit, and opens them read-only in **Code**.",
      },
      {
        title: "Images",
        body: "Images open in **Code**, and **Changes** and **History** compare two versions side by side or swiped. Click an image or a diagram on a page to zoom in.",
      },
      {
        title: "Boards and checklists",
        body: "Swimlanes without a card to show are left out, and epics named with a number first, such as `2 Build`, sort by it. Checklists on wiki pages tick as the page reads.",
      },
    ],
  },
  {
    version: "0.1",
    items: [
      {
        title: "Edit, Split and Preview",
        body: "Markdown, Mermaid and SVG files in **Code** open with **Edit**, **Split** and **Preview**. Side by side, the preview scrolls along with the editor, in the wiki too.",
      },
      {
        title: "Keep your place",
        body: "Switching between a page's editor and its preview keeps the line you were on, and Wiki, Tasks and Code return to what you had open in them.",
      },
      {
        title: "Branches of a task",
        body: "A task lists the branches whose name contains its ID, and **… → Create branch…** starts one. The sidebar shows the task of the checked-out branch.",
      },
      {
        title: "Editor font",
        body: "Choose JetBrains Mono, Fira Code, Cascadia Code or Roboto Mono, and whether ligatures join characters such as `->`, in **Settings → App**.",
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
