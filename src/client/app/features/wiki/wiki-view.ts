import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked, ViewEncapsulation } from "@angular/core";
import { LucideBookOpen, LucidePlus } from "@lucide/angular";
import { hotkey } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { EmptyState } from "../../ui/empty-state";
import { Resizable, ResizeHandle } from "../../ui/resizable";
import { FolderPage } from "./folder-page";
import { PageTree } from "./page-tree";
import { WikiActions } from "./wiki-actions";
import { findPage, flattenPages } from "./wiki-pages";
import { WikiPage } from "./wiki-page";

/**
 * The wiki: page tree and the open page or folder. Query parameters name
 * them (`?page=`, `?folder=`, `?anchor=`); without either, the home page opens.
 * The feature's styles are global but namespaced, so its sub-components share them.
 */
@Component({
  selector: "gd-wiki-view",
  imports: [EmptyState, FolderPage, PageTree, Resizable, ResizeHandle, WikiPage, LucideBookOpen, LucidePlus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./wiki.css",
  host: { class: "view" },
  template: `
    <div class="view-body">
      <aside class="side-panel" gdResizable="wiki-tree" [initial]="256" #panel="gdResizable" data-tour="wiki-tree">
        <gd-page-tree [selected]="page() ?? (folder() ? 'folder:' + folder() : null)" />
      </aside>
      <div [gdResizeHandle]="panel"></div>
      <section class="main-pane">
        @if (page(); as path) {
          @for (key of [path]; track key) {
            <gd-wiki-page [path]="path" [anchor]="anchor()" />
          }
        } @else if (folder(); as path) {
          <gd-folder-page [path]="path" />
        } @else if (!firstPage()) {
          <gd-empty-state title="No pages yet">
            <svg icon lucideBookOpen [size]="20" aria-hidden="true"></svg>
            <p>Pages are Markdown files in {{ root() }}/. Start with a home page.</p>
            <button type="button" class="btn btn-primary btn-m" (click)="createHome()">
              <svg lucidePlus [size]="14" aria-hidden="true"></svg><span>Create home page</span>
            </button>
          </gd-empty-state>
        }
      </section>
    </div>
  `,
})
export class WikiView {
  readonly page = input<string>();
  readonly folder = input<string>();
  readonly anchor = input<string>();

  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly wiki = inject(WikiActions);
  protected readonly root = computed(() => this.session.snapshot()!.settings.wikiRoot);
  private readonly home = computed(() => {
    const { wikiRoot, wikiHome } = this.session.snapshot()!.settings;
    return `${wikiRoot}/${wikiHome}`;
  });
  /** The home page, or the first page when there is no home page. */
  protected readonly firstPage = computed(() => {
    const wiki = this.session.snapshot()!.wiki;
    return findPage(wiki, this.home())?.node.path ?? flattenPages(wiki)[0]?.path ?? null;
  });

  constructor() {
    effect(() => {
      const first = this.firstPage();
      if (!this.page() && !this.folder() && first) untracked(() => void this.wiki.openPage(first, { replace: true }));
    });
    // N creates a page next to (below) the open one.
    hotkey("n", () => {
      const page = this.page();
      void this.wiki.createPage(page && findPage(this.session.snapshot()!.wiki, page)?.node.path ? page : undefined);
    });
  }

  protected async createHome() {
    const created = await this.session.run(() => this.api.content.createPage(this.home()));
    if (created) await this.wiki.openPage(created.path, { replace: true });
  }
}
