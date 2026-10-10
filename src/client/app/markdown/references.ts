/**
 * What a `[[reference]]` in Markdown points to, with what the client shows:
 * a task's state, a page's title, a file's lines. The rules are shared with
 * the link engine, in `utilities/references`.
 */
import {
  findReference,
  normalizeTitle,
  parseLines,
  referenceIndex,
  type ReferenceIndex,
  type ReferenceSources as Sources,
} from "../../../utilities/references";
import type { LineRange } from "../editor/code-editor";
import type { ReferenceCandidate } from "../editor/reference-completion";
import { statusTone, type StatusTone } from "../ui/status-tone";

export { normalizeTitle, parseLines };

interface ReferenceTask {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly status: string;
}

export interface ReferenceSources extends Sources<ReferenceTask> {
  /** Workflow states in order, for the colour of a task's state. */
  readonly statuses: readonly string[];
}

/** {@link ReferenceSources} indexed for lookups; build once per render. */
export interface ReferenceTargets extends ReferenceIndex<ReferenceTask> {
  readonly sources: ReferenceSources;
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

export function referenceTargets(sources: ReferenceSources): ReferenceTargets {
  return { ...referenceIndex(sources), sources };
}

export function resolveReference(target: string, targets: ReferenceTargets): Reference {
  const found = findReference(target, targets);
  switch (found.kind) {
    case "task": {
      const { statuses } = targets.sources;
      return { ...found.task, kind: "task", tone: statusTone(statuses.indexOf(found.task.status), statuses.length) };
    }
    case "page": {
      const anchor = found.anchor ? { anchor: found.anchor } : {};
      return { kind: "page", path: found.page.path, title: found.page.title, ...anchor };
    }
    case "file":
      return found;
    case "missing":
      return { kind: "missing-page", title: target.trim() };
  }
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
