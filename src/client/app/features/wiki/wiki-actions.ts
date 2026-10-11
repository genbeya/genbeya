/** Creating, moving and deleting pages, and following links; shared by the wiki, tasks and the palette. */
import { computed, Injectable, inject } from "@angular/core";
import { Router } from "@angular/router";
import { Dialogs } from "../../core/dialogs";
import { ExternalLinks } from "../../core/external-links";
import { Session } from "../../core/session";
import { sameJson } from "../../core/signals";
import { WorkspaceApi } from "../../core/workspace-api";
import type { WikiNode } from "../../../../contracts/model";
import type { LinkTarget } from "../../markdown/link-target";
import { parseLines, referenceCandidates } from "../../markdown/references";
import type { GitdeskOptions } from "../../markdown/markdown-pipeline";
import { filePaths } from "../../../../utilities/file-tree";
import type { MovePageOptions, PageMoveChoice } from "./move-page-dialog";
import { findPage, flattenPages, pageName, pageNameProblem, pagePath } from "./wiki-pages";

@Injectable({ providedIn: "root" })
export class WikiActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly router = inject(Router);
  private readonly external = inject(ExternalLinks);
  private readonly root = computed(() => this.session.snapshot()?.settings.wikiRoot ?? "docs");

  /** Tasks, pages and files that Markdown can reference by ID, title or path. */
  readonly linkTargets = computed<GitdeskOptions>(
    () => {
      const snapshot = this.session.snapshot();
      return {
        references: {
          wikiRoot: this.root(),
          pages: flattenPages(snapshot?.wiki ?? []).map(({ title, path }) => ({ title, path })),
          tasks: (snapshot?.tasks ?? []).map(({ id, path, title, status }) => ({ id, path, title, status })),
          statuses: snapshot?.settings.statuses ?? [],
          files: filePaths(snapshot?.files ?? []),
        },
      };
    },
    { equal: sameJson },
  );

  /** What `[[` offers in Markdown editors. */
  readonly referenceCandidates = computed(() => referenceCandidates(this.linkTargets().references!));

  openPage(page: string, options: { anchor?: string; replace?: boolean } = {}): Promise<boolean> {
    return this.router.navigate(["/wiki"], { queryParams: { page, anchor: options.anchor }, replaceUrl: options.replace });
  }

  openFolder(folder: string): Promise<boolean> {
    return this.router.navigate(["/wiki"], { queryParams: { folder } });
  }

  /** Opens a page, or a folder without a page of its own. */
  openNode(node: WikiNode): Promise<boolean> {
    if (node.path) return this.openPage(node.path);
    return node.folder ? this.openFolder(node.folder) : Promise.resolve(false);
  }

  /** Asks for a name, below `parent` (a page) when given, and creates the page. */
  async createPage(parent?: string, name = ""): Promise<void> {
    const root = this.root();
    let created: Awaited<ReturnType<WorkspaceApi["content"]["createPage"]>> | undefined;
    const value = await this.dialogs.prompt({
      title: "New page",
      label: "Page name",
      initial: (parent ? `${pageName(parent, root)}/` : "") + name,
      placeholder: "Architecture/Database",
      confirm: "Create",
      hint: `Use / to nest pages. The page is saved as Markdown in ${root}/.`,
      validate: pageNameProblem,
      // A page that exists already is reported in the dialog, which stays open for another name.
      accept: (name) => this.session.attempt(async () => (created = await this.api.content.createPage(pagePath(root, name)))),
    });
    if (!value || !created) return;
    this.session.contentChanged();
    await this.openPage(created.path);
  }

  /** Asks for a new name and moves the page with its subpages, updating the links to them if wanted. */
  async movePage(path: string): Promise<void> {
    const { MovePageDialog } = await import("./move-page-dialog");
    const choice = await this.dialogs.open<PageMoveChoice, MovePageOptions>(MovePageDialog, { path });
    if (!choice) return;
    const moved = await this.session.run(
      () => this.api.content.movePage(path, choice.to, { updateLinks: choice.updateLinks }),
      "Page moved",
    );
    if (!moved) return;
    this.session.contentChanged();
    await this.openPage(moved, { replace: true });
  }

  async deletePage(path: string): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: "Delete page",
      message: `Delete ${pageName(path, this.root())}? The file is removed from the working tree; Git history keeps it.`,
      confirm: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    const deleted = await this.session.run(async () => (await this.api.content.deletePage(path), true), "Page deleted");
    if (!deleted) return;
    this.session.contentChanged();
    await this.router.navigate(["/wiki"], { replaceUrl: true });
  }

  /** Follows a link from a page or a task description. */
  async followLink(target: LinkTarget): Promise<void> {
    if (target.kind === "external") {
      return this.external.open(target.url);
    }
    if (target.kind === "missing") return this.createPage(undefined, target.title);
    if (target.kind !== "file") return;
    const snapshot = this.session.snapshot();
    if (!snapshot) return;
    const { taskRoot } = snapshot.settings;
    const root = this.root();
    let path = target.path;
    const task = path.startsWith(`${taskRoot}/`) ? snapshot.tasks.find((candidate) => candidate.path === path) : undefined;
    if (task) return void (await this.router.navigate(["/tasks"], { queryParams: { task: task.id } }));
    if (path === root || path.startsWith(`${root}/`)) {
      // Links may leave out `.md` or point at a page's folder.
      if (!/\.[a-z0-9]+$/i.test(path)) path += ".md";
      if (path.endsWith(".md")) {
        const found = findPage(snapshot.wiki, path) ?? findPage(snapshot.wiki, path.slice(0, -3));
        if (found?.node.path) return void (await this.openPage(found.node.path, { anchor: target.anchor }));
        if (found?.node.folder) return void (await this.openFolder(found.node.folder));
        return void (await this.openPage(path, { anchor: target.anchor }));
      }
    }
    const lines = parseLines(target.anchor);
    await this.router.navigate(["/code"], { queryParams: { file: path, lines: lines ? `${lines.from}-${lines.to}` : null } });
  }
}
