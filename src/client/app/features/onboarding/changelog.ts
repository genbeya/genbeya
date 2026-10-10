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
    // PLACEHOLDER: lists what exists so far. Complete it with everything else 0.3 brings before releasing.
    version: "0.3",
    items: [
      {
        title: "A guided tour",
        body: "A short walk through the wiki, tasks, code, version control and the rest. Run **Start the tour** from the command palette any time.",
        target: '[data-tour="search"]',
      },
      {
        title: "A sample project",
        body: "Try GitDesk on a small sample repository: **Try GitDesk with a sample project** on the start screen.",
      },
      {
        title: "Terminal in the sidebar",
        body: "The terminal has a button in the sidebar now, next to its shortcut.",
        target: '[data-tour="terminal"]',
      },
      {
        title: "Help and what's new",
        body: "**Settings → Help** shows the version, opens the documentation, the tour and these notes, which also appear after each update.",
        target: '[data-tour="help"]',
        route: "/settings",
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
