/**
 * Full-text search of an open repository. The checkout supplies the code,
 * and the wiki and the tasks come from wherever their area lives, so the
 * copy an area on the content branch left in the checkout (or the reverse)
 * is not listed twice.
 */
import type { SearchArea, SearchHit, SearchMatch, SearchRange, SearchResults, Settings, Task, TaskSearchHit } from "../contracts/model";
import type { FileStore } from "../access/files/file-store";
import type { Git } from "../access/git/git";
import { grepFiles, grepLines, type GrepLine } from "../access/git/git-grep";
import { SEARCH_LIMITS, type SearchEngine, type SearchQuery } from "../engines/search-engine";
import type { TaskEngine } from "../engines/task-engine";
import type { WikiEngine } from "../engines/wiki-engine";
import { baseName } from "../utilities/repository-path";
import type { Workspace } from "./workspace";

export interface SearchEngines {
  readonly search: SearchEngine;
  readonly tasks: TaskEngine;
  readonly wiki: WikiEngine;
}

const AREAS: readonly SearchArea[] = ["wiki", "tasks", "code"];

/** A working tree to search, and the areas it supplies. */
interface Source {
  readonly git: Git;
  readonly areas: readonly SearchArea[];
}

export async function searchContent(workspace: Workspace, engines: SearchEngines, query: SearchQuery): Promise<SearchResults> {
  const { settings } = await workspace.settings();
  const located = { wiki: await workspace.content.locate("wiki"), tasks: await workspace.content.locate("tasks") };
  // One source per working tree: code is in the checkout, wiki and tasks wherever their area lives.
  const byRoot = new Map<string, Source>([[workspace.checkout.root, { git: workspace.repository.git, areas: ["code"] }]]);
  for (const area of ["wiki", "tasks"] as const) {
    const { root, git } = located[area];
    byRoot.set(root, { git, areas: [...(byRoot.get(root)?.areas ?? []), area] });
  }
  const sources = [...byRoot.values()];

  // The files with a match, at most so many per area; then only their lines are read.
  let truncated = false;
  const files = new Map<SearchArea, string[]>(AREAS.map((area) => [area, []]));
  const lines = new Map<string, GrepLine[]>();
  for (const source of sources) {
    const listed: string[] = [];
    for (const path of await grepFiles(source.git, query)) {
      const area = engines.search.areaOf(path, settings);
      if (!source.areas.includes(area)) continue;
      const paths = files.get(area)!;
      if (paths.length === SEARCH_LIMITS.filesPerArea) truncated = true;
      else {
        paths.push(path);
        listed.push(path);
      }
    }
    for (const line of await grepLines(source.git, query, listed)) {
      if (!lines.has(line.path)) lines.set(line.path, []);
      lines.get(line.path)!.push(line);
    }
  }

  const match = engines.search.matcher(query);
  const hits = (area: SearchArea): SearchHit[] =>
    files.get(area)!.flatMap((path) => {
      const matches = matchesOf(lines.get(path) ?? [], match, engines.search);
      if (matches.length > SEARCH_LIMITS.matchesPerFile) truncated = true;
      if (!matches.length) return [];
      const title = area === "wiki" ? engines.wiki.titleOf(path) : baseName(path);
      return [{ path, scope: area === "code" ? "repo" : "content", title, matches: matches.slice(0, SEARCH_LIMITS.matchesPerFile) }];
    });
  const [wiki, tasks, code] = [hits("wiki"), hits("tasks"), hits("code")];
  return { wiki, tasks: await describeTasks(located.tasks.files, engines.tasks, settings, tasks), code, truncated };
}

/** The matching lines of one file, each with the lines around it. */
function matchesOf(lines: readonly GrepLine[], match: (line: string) => SearchRange[], engine: SearchEngine): SearchMatch[] {
  const text = new Map(lines.map((line) => [line.line, line.text]));
  const around = (line: number) => {
    const value = text.get(line);
    return value === undefined ? null : engine.excerpt(value, []).text;
  };
  return lines
    .filter((line) => line.match)
    .map((line) => ({
      line: line.line,
      ...engine.excerpt(line.text, match(line.text)),
      before: around(line.line - 1),
      after: around(line.line + 1),
    }));
}

/** Task hits with ID, title and status; a task file that does not parse is named after the file. */
async function describeTasks(
  files: FileStore,
  engine: TaskEngine,
  settings: Settings,
  hits: readonly SearchHit[],
): Promise<TaskSearchHit[]> {
  const contents = await files.readMany(hits.map((hit) => hit.path));
  return hits.map((hit, i) => {
    const file = contents[i];
    let task: Task | null = null;
    try {
      if (file && !(file instanceof Error)) task = engine.parse(hit.path, file.content, file.hash, settings.taskRoot);
    } catch {
      /* Listed under its file name. */
    }
    const id = task?.id ?? baseName(hit.path).replace(/\.md$/i, "");
    return { ...hit, id, title: task?.title ?? id, status: task?.status ?? "" };
  });
}
