/**
 * Where each view was left: going back to it from the sidebar, `Mod+1` … `Mod+5`
 * or the palette returns to the page, task or file that was open there. Kept
 * per repository for as long as the app runs, not saved.
 */
import { DestroyRef, inject, Injectable, signal } from "@angular/core";
import { NavigationEnd, Router, type Params } from "@angular/router";
import { repositoryKey, type Snapshot } from "../../../../contracts/model";
import { filePaths } from "../../../../utilities/file-tree";
import { Session } from "../../core/session";
import { flattenPages } from "../wiki/wiki-pages";

/** The views of the sidebar, in its order; `Mod+1` … `Mod+5` go to them. */
export const VIEWS = ["wiki", "tasks", "code", "changes", "history"] as const;
export type View = (typeof VIEWS)[number];

/** Parameters that ask for something once (a line to scroll to, a new task), not a place to return to. */
const TRANSIENT: Readonly<Record<View, readonly string[]>> = {
  wiki: ["line", "anchor"],
  tasks: ["create"],
  code: ["lines", "rev"],
  changes: [],
  history: [],
};

/** Drops the parameters naming something the snapshot no longer has: a deleted page, task or file. */
function stillThere(view: View, params: Params, snapshot: Snapshot): Params {
  const gone = new Set<string>();
  const drop = (key: string, exists: (value: string) => boolean) => {
    if (typeof params[key] === "string" && !exists(params[key])) gone.add(key);
  };
  switch (view) {
    case "wiki": {
      const pages = flattenPages(snapshot.wiki);
      drop("page", (path) => pages.some((page) => page.path === path));
      drop("folder", (folder) => pages.some((page) => page.path.startsWith(`${folder}/`)));
      break;
    }
    case "tasks":
      drop("task", (id) => snapshot.tasks.some((task) => task.id === id));
      break;
    case "code": {
      const files = new Set(filePaths(snapshot.files));
      drop("file", (path) => files.has(path));
      break;
    }
    case "changes":
      drop("file", (path) => snapshot.changes.some((change) => change.path === path));
      drop("stash", (hash) => snapshot.stashes.some((stash) => stash.hash === hash));
      drop("conflict", () => snapshot.operation !== null);
      break;
    case "history":
      break;
  }
  return without(params, gone);
}

const without = (params: Params, keys: ReadonlySet<string>): Params =>
  Object.fromEntries(Object.entries(params).filter(([key]) => !keys.has(key)));

@Injectable({ providedIn: "root" })
export class ViewMemory {
  private readonly router = inject(Router);
  private readonly session = inject(Session);
  /** By repository, then by view: the query parameters the view was left with. */
  private readonly left = signal<ReadonlyMap<string, Partial<Record<View, Params>>>>(new Map());

  constructor() {
    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.remember(event.urlAfterRedirects);
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  private repository(): string | null {
    const snapshot = this.session.snapshot();
    return snapshot ? repositoryKey(snapshot.location) : null;
  }

  private remember(url: string) {
    const repository = this.repository();
    const tree = this.router.parseUrl(url);
    const view = tree.root.children["primary"]?.segments[0]?.path as View | undefined;
    if (!repository || !view || !VIEWS.includes(view)) return;
    const params = without(tree.queryParams, new Set(TRANSIENT[view]));
    this.left.update((left) => new Map(left).set(repository, { ...left.get(repository), [view]: params }));
  }

  /** The query parameters that return to where `view` was left; none for a view not visited yet. */
  params(view: View): Params {
    const repository = this.repository();
    const params = repository ? this.left().get(repository)?.[view] : undefined;
    const snapshot = this.session.snapshot();
    return params && snapshot ? stillThere(view, params, snapshot) : {};
  }

  /** Goes to `view`, where it was left. */
  open(view: View): Promise<boolean> {
    return this.router.navigate([`/${view}`], { queryParams: this.params(view) });
  }
}
