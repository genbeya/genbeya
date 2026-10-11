/**
 * What a `[[reference]]` in Markdown points to: a task by ID, a wiki page by
 * title or path, or a repository file, optionally with lines (`#L10-L20`).
 * The client renders references; the link engine rewrites them when pages move.
 */
import { validateRepositoryPath } from "./repository-path";

/**
 * `[[target]]` or `[[target|label]]`. Neither holds `[[`, which starts the
 * next reference, so matching takes linear time on any line.
 */
export const WIKILINK = /\[\[((?:[^\]|\n[]|\[(?!\[))+)(?:\|((?:[^\]\n[]|\[(?!\[))+))?\]\]/g;

export interface ReferencePage {
  readonly title: string;
  readonly path: string;
}

export interface LineRange {
  readonly from: number;
  readonly to: number;
}

export interface ReferenceSources<T extends { readonly id: string }> {
  readonly wikiRoot: string;
  readonly pages: readonly ReferencePage[];
  readonly tasks: readonly T[];
  /** Every file of the repository. */
  readonly files: readonly string[];
}

/** {@link ReferenceSources} indexed for lookups; build once per document set. */
export interface ReferenceIndex<T extends { readonly id: string }> {
  readonly wikiRoot: string;
  readonly tasks: ReadonlyMap<string, T>;
  readonly pagesByTitle: ReadonlyMap<string, ReferencePage>;
  readonly pagesByPath: ReadonlyMap<string, ReferencePage>;
  readonly files: ReadonlySet<string>;
}

/** How a reference names a page by path: from the repository root or the wiki folder, with or without `.md`. */
export interface PathStyle {
  readonly root: "repository" | "wiki";
  readonly extension: boolean;
}

export type FoundReference<T> =
  | { readonly kind: "task"; readonly task: T }
  | { readonly kind: "page"; readonly page: ReferencePage; readonly style: "title" | PathStyle; readonly anchor?: string }
  | { readonly kind: "file"; readonly path: string; readonly lines: LineRange | null; readonly exists: boolean }
  | { readonly kind: "missing" };

/** Titles match regardless of case, dashes and underscores. */
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .trim();

const LINES = /^L(\d+)(?:-L?(\d+))?$/i;
/** Something with a folder or an extension is meant as a path. */
const PATH_LIKE = /[/\\]|\.[A-Za-z0-9]+$/;
const PATH_STYLES: readonly PathStyle[] = [
  { root: "repository", extension: true },
  { root: "repository", extension: false },
  { root: "wiki", extension: true },
  { root: "wiki", extension: false },
];

export function referenceIndex<T extends { readonly id: string }>(sources: ReferenceSources<T>): ReferenceIndex<T> {
  return {
    wikiRoot: sources.wikiRoot,
    tasks: new Map(sources.tasks.map((task) => [task.id.toUpperCase(), task])),
    pagesByTitle: new Map(sources.pages.map((page) => [normalizeTitle(page.title), page])),
    pagesByPath: new Map(sources.pages.map((page) => [page.path.toLowerCase(), page])),
    files: new Set(sources.files),
  };
}

/** `L10`, `L10-L20` or `L10-20`, in either order; null for anything else. */
export function parseLines(fragment: string | undefined): LineRange | null {
  const match = fragment ? LINES.exec(fragment) : null;
  if (!match) return null;
  const [a, b] = [Number(match[1]), Number(match[2] ?? match[1])];
  return a > 0 && b > 0 ? { from: Math.min(a, b), to: Math.max(a, b) } : null;
}

const repositoryPath = (value: string): string | null => {
  try {
    return validateRepositoryPath(value.replace(/^\/+/, ""), false);
  } catch {
    return null;
  }
};

/** Tasks first, then pages, then files: a task ID or a page title never turns into a file. */
export function findReference<T extends { readonly id: string }>(target: string, index: ReferenceIndex<T>): FoundReference<T> {
  const [name = "", fragment] = target.trim().split("#", 2);
  const task = index.tasks.get(name.toUpperCase());
  if (task) return { kind: "task", task };
  const anchor = fragment ? { anchor: fragment } : {};
  const byTitle = index.pagesByTitle.get(normalizeTitle(name));
  if (byTitle) return { kind: "page", page: byTitle, style: "title", ...anchor };
  const path = repositoryPath(name);
  if (!path) return { kind: "missing" };
  for (const style of PATH_STYLES) {
    const candidate = (style.root === "wiki" ? `${index.wikiRoot}/` : "") + path + (style.extension ? "" : ".md");
    const page = index.pagesByPath.get(candidate.toLowerCase());
    if (page) return { kind: "page", page, style, ...anchor };
  }
  if (index.files.has(path) || PATH_LIKE.test(name))
    return { kind: "file", path, lines: parseLines(fragment), exists: index.files.has(path) };
  return { kind: "missing" };
}
