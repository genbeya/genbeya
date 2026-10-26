/**
 * What a `[[reference]]` in Markdown points to: a task by ID, a wiki page by
 * title or path, or a repository file, optionally with lines (`#L10-L20`)
 * and pinned to a revision (`#L10-L20@v1.0`, or `#@v1.0` for the whole file).
 * The client renders references; the link engine rewrites them when pages move.
 */
import type { RevisionFile } from "../contracts/model";
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
  | {
      readonly kind: "file";
      readonly path: string;
      readonly lines: LineRange | null;
      /** The revision the reference is pinned to; null for the file as it is now. */
      readonly revision: string | null;
      /** Whether the checkout has the file. */
      readonly exists: boolean;
    }
  | { readonly kind: "missing" };

/** Lines of a file, of its version in a revision when pinned. */
export interface FileFragment {
  readonly lines: LineRange | null;
  readonly revision: string | null;
}

/** Titles match regardless of case, dashes and underscores. */
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .trim();

const LINES = /^L(\d+)(?:-L?(\d+))?$/i;
/**
 * A revision as a reference names it: a commit ID, a tag, a branch, or
 * `HEAD~2`. It never starts like an option, and holds no `:` (a path), `..`
 * (a range) or `@` (reflog syntax), so Git only ever reads it as a revision.
 */
const REVISION = /^(?!.*\.\.)[A-Za-z0-9_][A-Za-z0-9._/~^-]{0,199}$/;
const FULL_COMMIT_ID = /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/;
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

export const isRevision = (value: unknown): value is string => typeof value === "string" && REVISION.test(value);

/** `L10-L20`, `L10-L20@<revision>` or `@<revision>`; a revision that is not one is left out. */
export function parseFileFragment(fragment: string | undefined): FileFragment {
  const at = fragment?.indexOf("@") ?? -1;
  const revision = at < 0 ? null : fragment!.slice(at + 1);
  return { lines: parseLines(at < 0 ? fragment : fragment!.slice(0, at)), revision: isRevision(revision) ? revision : null };
}

/** The fragment of a file reference or link: `L10-L20`, with `@<revision>` when pinned; empty for a whole file now. */
export function fileFragment({ lines, revision }: FileFragment): string {
  return (lines ? `L${lines.from}-L${lines.to}` : "") + (revision ? `@${revision}` : "");
}

/** A revision as shown: commit IDs shortened to 7 characters, names as written. */
export const shortRevision = (revision: string): string => (FULL_COMMIT_ID.test(revision) ? revision.slice(0, 7) : revision);

/** The text of `path` as committed in `revision`; an error saying what is missing when it isn't there. */
export function pinnedText({ commit, content }: RevisionFile, path: string, revision: string): string {
  if (commit === null) throw new Error(`${revision} is not in this clone. Fetch it, or check the reference.`);
  if (content === null) throw new Error(`${path} is not in ${shortRevision(revision)}.`);
  return content;
}

const repositoryPath = (value: string): string | null => {
  try {
    return validateRepositoryPath(value.replace(/^\/+/, ""), false);
  } catch {
    return null;
  }
};

/**
 * Tasks first, then pages, then files: a task ID or a page title never turns
 * into a file. A page pinned to a revision (`[[Home#L3@v1.0]]`) is its file.
 */
export function findReference<T extends { readonly id: string }>(target: string, index: ReferenceIndex<T>): FoundReference<T> {
  const [name = "", fragment] = target.trim().split("#", 2);
  const task = index.tasks.get(name.toUpperCase());
  if (task) return { kind: "task", task };
  const file = parseFileFragment(fragment);
  const found = (page: ReferencePage, style: "title" | PathStyle): FoundReference<T> =>
    file.revision
      ? { kind: "file", path: page.path, ...file, exists: index.files.has(page.path) }
      : { kind: "page", page, style, ...(fragment ? { anchor: fragment } : {}) };
  const byTitle = index.pagesByTitle.get(normalizeTitle(name));
  if (byTitle) return found(byTitle, "title");
  const path = repositoryPath(name);
  if (!path) return { kind: "missing" };
  for (const style of PATH_STYLES) {
    const candidate = (style.root === "wiki" ? `${index.wikiRoot}/` : "") + path + (style.extension ? "" : ".md");
    const page = index.pagesByPath.get(candidate.toLowerCase());
    if (page) return found(page, style);
  }
  if (index.files.has(path) || PATH_LIKE.test(name)) return { kind: "file", path, ...file, exists: index.files.has(path) };
  return { kind: "missing" };
}
