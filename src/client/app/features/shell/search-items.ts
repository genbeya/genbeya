/** Full-text search in the command palette: the "/" prefix, and its results as palette rows. */
import type { SearchHit, SearchMatch, SearchRange, SearchResults } from "../../../../contracts/model";
import type { PaletteItem } from "./palette-items";

/** Typed first in the palette, it searches the text of pages, tasks and files. */
export const SEARCH_PREFIX = "/";

/** The text to search for when `query` asks for full-text search; null when it does not. */
export const searchText = (query: string): string | null => (query.startsWith(SEARCH_PREFIX) ? query.slice(SEARCH_PREFIX.length) : null);

export interface Segment {
  readonly text: string;
  readonly mark: boolean;
}

/** A matching line, shown below the heading of its file. */
export interface MatchView {
  /** The file's heading: page title, task ID and title, or path. */
  readonly file: string;
  /** Shown beside the heading: the page's path or the task's status. */
  readonly fileDetail: string;
  readonly line: number;
  readonly segments: readonly Segment[];
  /** The lines around it, without indentation; null at the start or end of the file. */
  readonly before: string | null;
  readonly after: string | null;
}

export type PaletteRow = PaletteItem & { readonly match?: MatchView };

/** Where a chosen match opens; the palette closes first. */
export interface SearchCommands {
  openPage(path: string, line: number): void;
  openTask(id: string): void;
  openFile(path: string, line: number): void;
}

function rows<T extends SearchHit>(
  hits: readonly T[],
  group: string,
  icon: PaletteItem["icon"],
  heading: (hit: T) => Pick<MatchView, "file" | "fileDetail">,
  open: (hit: T, match: SearchMatch) => void,
): PaletteRow[] {
  return hits.flatMap((hit) =>
    hit.matches.map((match) => ({
      id: `${group}:${hit.path}:${match.line}`,
      group,
      label: `${heading(hit).file}, line ${match.line}: ${match.text.trim()}`,
      icon,
      match: {
        ...heading(hit),
        line: match.line,
        segments: segments(match.text, match.ranges),
        before: match.before?.trim() ?? null,
        after: match.after?.trim() ?? null,
      },
      run: () => open(hit, match),
    })),
  );
}

/** One row per matching line, grouped into Wiki, Tasks and Code. */
export function searchItems(results: SearchResults, commands: SearchCommands): PaletteRow[] {
  return [
    ...rows(
      results.wiki,
      "Wiki",
      "page",
      (page) => ({ file: page.title, fileDetail: page.path }),
      (page, match) => commands.openPage(page.path, match.line),
    ),
    ...rows(
      results.tasks,
      "Tasks",
      "task",
      (task) => ({ file: `${task.id} ${task.title}`, fileDetail: task.status }),
      (task) => commands.openTask(task.id),
    ),
    ...rows(
      results.code,
      "Code",
      "file",
      (file) => ({ file: file.path, fileDetail: "" }),
      (file, match) => commands.openFile(file.path, match.line),
    ),
  ];
}

/** `text` cut into plain and highlighted parts, without its indentation. */
export function segments(text: string, ranges: readonly SearchRange[]): Segment[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  let at = Math.min(text.length - text.trimStart().length, sorted[0]?.start ?? Infinity);
  const result: Segment[] = [];
  for (const range of sorted) {
    if (range.end <= at) continue;
    if (range.start > at) result.push({ text: text.slice(at, range.start), mark: false });
    result.push({ text: text.slice(Math.max(at, range.start), range.end), mark: true });
    at = range.end;
  }
  if (at < text.length) result.push({ text: text.slice(at), mark: false });
  return result;
}

/** "3 matches in 2 files", for the palette's status line. */
export function describeResults(results: SearchResults): string {
  const hits = [...results.wiki, ...results.tasks, ...results.code];
  const matches = hits.reduce((sum, hit) => sum + hit.matches.length, 0);
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  if (!matches) return "No matches";
  return `${count(matches, "match", "matches")} in ${count(hits.length, "file", "files")}${results.truncated ? ", more not shown" : ""}`;
}
