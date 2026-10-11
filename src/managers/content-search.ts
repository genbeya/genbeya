/**
 * Full-text search of an open repository. Each file is searched where its
 * area lives: code in the checkout, and the wiki, the tasks and the settings
 * file wherever theirs is, so the copy an area on the content branch left in
 * the checkout (or the reverse) is not listed as well.
 */
import type { ContentArea, SearchArea, SearchHit, SearchMatch, SearchResults, Settings, Task, TaskSearchHit } from "../contracts/model";
import { CONTENT_AREAS } from "../contracts/model";
import type { FileStore } from "../access/files/file-store";
import type { Git } from "../access/git/git";
import { grepFiles, grepLines, type GrepLine } from "../access/git/git-grep";
import { SEARCH_LIMITS, type SearchEngine, type SearchQuery } from "../engines/search-engine";
import { contentAreaOf } from "../engines/settings-engine";
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

/** A working tree to search, and the content areas it holds; "code" is everything else. */
interface Source {
  readonly git: Git;
  readonly holds: readonly (ContentArea | "code")[];
}

export async function searchContent(workspace: Workspace, engines: SearchEngines, query: SearchQuery): Promise<SearchResults> {
  const { settings } = await workspace.settings();
  // One source per working tree: code is in the checkout, each content area wherever it lives.
  const byRoot = new Map<string, Source>([[workspace.checkout.root, { git: workspace.repository.git, holds: ["code"] }]]);
  for (const area of CONTENT_AREAS) {
    const location = await workspace.content.locate(area);
    byRoot.set(location.root, { git: location.git, holds: [...(byRoot.get(location.root)?.holds ?? []), area] });
  }

  // The files with a match, at most so many per area; then only their lines are read.
  let truncated = false;
  const files = new Map<SearchArea, string[]>(AREAS.map((area) => [area, []]));
  const matches = new Map<string, SearchMatch[]>();
  for (const source of byRoot.values()) {
    const listed: string[] = [];
    for (const path of await grepFiles(source.git, query)) {
      if (!source.holds.includes(contentAreaOf(path, settings) ?? "code")) continue;
      const paths = files.get(engines.search.areaOf(path, settings))!;
      if (paths.length === SEARCH_LIMITS.filesPerArea) truncated = true;
      else {
        paths.push(path);
        listed.push(path);
      }
    }
    // One more match than shown tells that a file has more.
    const lines = new Map<string, GrepLine[]>(listed.map((path) => [path, []]));
    for (const line of await grepLines(source.git, query, listed, SEARCH_LIMITS.matchesPerFile + 1)) lines.get(line.path)?.push(line);
    for (const [path, found] of lines) matches.set(path, matchesOf(found, engines.search));
  }

  const hits = (area: SearchArea): SearchHit[] =>
    files.get(area)!.flatMap((path) => {
      const found = matches.get(path) ?? [];
      if (found.length > SEARCH_LIMITS.matchesPerFile) truncated = true;
      if (!found.length) return [];
      const title = area === "wiki" ? engines.wiki.titleOf(path) : baseName(path);
      const scope = contentAreaOf(path, settings) ? "content" : "repo";
      return [{ path, scope, title, matches: found.slice(0, SEARCH_LIMITS.matchesPerFile) }];
    });
  const [wiki, tasks, code] = [hits("wiki"), hits("tasks"), hits("code")];
  const taskFiles = (await workspace.content.locate("tasks")).files;
  return { wiki, tasks: await describeTasks(taskFiles, engines.tasks, settings, tasks), code, truncated };
}

/** The matching lines of one file, each with the lines around it, shortened as they are shown. */
function matchesOf(lines: readonly GrepLine[], engine: SearchEngine): SearchMatch[] {
  const text = new Map(lines.map((line) => [line.line, line.text]));
  const around = (line: number) => {
    const value = text.get(line);
    return value === undefined ? null : engine.excerpt(value, []).text;
  };
  return lines
    .filter((line) => line.match)
    .map((line) => ({
      line: line.line,
      ...engine.excerpt(line.text, line.ranges),
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
