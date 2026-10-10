/**
 * What a `[[reference]]` in Markdown points to: a task by ID, a wiki page by
 * title or path, or a repository file, optionally with lines (`#L10-L20`).
 */
import { validateRepositoryPath } from "../../../utilities/repository-path";
import type { LineRange } from "../editor/code-editor";
import type { ReferenceCandidate } from "../editor/reference-completion";
import { statusTone, type StatusTone } from "../ui/status-tone";

export interface ReferenceSources {
  readonly wikiRoot: string;
  readonly pages: readonly { readonly title: string; readonly path: string }[];
  readonly tasks: readonly { readonly id: string; readonly path: string; readonly title: string; readonly status: string }[];
  /** Workflow states in order, for the colour of a task's state. */
  readonly statuses: readonly string[];
  /** Every file of the repository. */
  readonly files: readonly string[];
}

/** {@link ReferenceSources} indexed for lookups; build once per render. */
export interface ReferenceTargets {
  readonly sources: ReferenceSources;
  readonly tasks: ReadonlyMap<string, ReferenceSources["tasks"][number]>;
  readonly pagesByTitle: ReadonlyMap<string, ReferenceSources["pages"][number]>;
  readonly pagesByPath: ReadonlyMap<string, ReferenceSources["pages"][number]>;
  readonly files: ReadonlySet<string>;
}

export type Reference =
  | {
      readonly kind: "task";
      readonly id: string;
      readonly path: string;
      readonly title: string;
      readonly status: string;
      readonly tone: StatusTone;
    }
  | { readonly kind: "page"; readonly path: string; readonly title: string; readonly anchor?: string }
  | { readonly kind: "file"; readonly path: string; readonly lines: LineRange | null; readonly exists: boolean }
  | { readonly kind: "missing-page"; readonly title: string };

/** Titles match regardless of case, dashes and underscores. */
export const normalizeTitle = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[-_\s]+/g, " ")
    .trim();

const LINES = /^L(\d+)(?:-L?(\d+))?$/i;
/** Something with a folder or an extension is meant as a path. */
const PATH_LIKE = /[/\\]|\.[A-Za-z0-9]+$/;

export function referenceTargets(sources: ReferenceSources): ReferenceTargets {
  return {
    sources,
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
export function resolveReference(target: string, targets: ReferenceTargets): Reference {
  const [name = "", fragment] = target.trim().split("#", 2);
  const task = targets.tasks.get(name.toUpperCase());
  if (task) {
    const index = targets.sources.statuses.indexOf(task.status);
    return { ...task, kind: "task", tone: statusTone(index, targets.sources.statuses.length) };
  }
  const anchor = fragment ? { anchor: fragment } : {};
  const byTitle = targets.pagesByTitle.get(normalizeTitle(name));
  if (byTitle) return { kind: "page", path: byTitle.path, title: byTitle.title, ...anchor };
  const path = repositoryPath(name);
  if (!path) return { kind: "missing-page", title: target.trim() };
  const { wikiRoot } = targets.sources;
  for (const candidate of [path, `${path}.md`, `${wikiRoot}/${path}`, `${wikiRoot}/${path}.md`]) {
    const page = targets.pagesByPath.get(candidate.toLowerCase());
    if (page) return { kind: "page", path: page.path, title: page.title, ...anchor };
  }
  if (targets.files.has(path) || PATH_LIKE.test(name))
    return { kind: "file", path, lines: parseLines(fragment), exists: targets.files.has(path) };
  return { kind: "missing-page", title: target.trim() };
}

/**
 * What `[[` offers while typing: tasks by ID and title, pages by title (by
 * path when titles repeat), and the other files of the repository.
 */
export function referenceCandidates(sources: ReferenceSources): ReferenceCandidate[] {
  const titles = new Map<string, number>();
  for (const page of sources.pages) titles.set(normalizeTitle(page.title), (titles.get(normalizeTitle(page.title)) ?? 0) + 1);
  const below = (path: string) => path.slice(sources.wikiRoot.length + 1).replace(/\.md$/, "");
  const shown = new Set([...sources.pages.map((page) => page.path), ...sources.tasks.map((task) => task.path)]);
  return [
    ...sources.tasks.map((task): ReferenceCandidate => ({
      target: task.id,
      label: `${task.id} ${task.title}`,
      detail: task.status.replace(/[-_]+/g, " "),
      kind: "task",
    })),
    ...sources.pages.map((page): ReferenceCandidate => {
      const unique = titles.get(normalizeTitle(page.title)) === 1;
      return {
        target: unique ? page.title : below(page.path),
        label: unique ? page.title : below(page.path),
        detail: "page",
        kind: "page",
      };
    }),
    ...sources.files.filter((path) => !shown.has(path)).map((path): ReferenceCandidate => ({ target: path, label: path, kind: "file" })),
  ];
}
