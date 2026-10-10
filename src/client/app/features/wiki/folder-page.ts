import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { Breadcrumbs } from "./breadcrumbs";
import { WikiActions } from "./wiki-actions";
import { findPage, nodeKey } from "./wiki-pages";

/** A folder without its own page: its pages as cards, and an offer to write an overview. */
@Component({
  selector: "gd-folder-page",
  imports: [Breadcrumbs, EmptyState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    @if (node(); as folder) {
      <header class="view-header">
        <gd-breadcrumbs [path]="path()" />
        <span class="grow"></span>
        <button type="button" class="btn btn-default btn-m" (click)="writeOverview()">
          <svg gd-icon name="file-plus-2" [size]="14"></svg><span>Write an overview page</span>
        </button>
      </header>
      <div class="content-scroll">
        <div class="document">
          <div class="document-article">
            <h1 class="folder-title">{{ folder.title }}</h1>
            <div class="folder-list">
              @for (child of folder.children; track key(child)) {
                <button type="button" class="folder-card" (click)="wiki.openNode(child)">
                  @if (child.path) {
                    <svg gd-icon name="file-text" [size]="16"></svg>
                  } @else {
                    <svg gd-icon name="folder" [size]="16"></svg>
                  }
                  <span class="grow">{{ child.title }}</span>
                  @if (child.children.length) {
                    <span class="faint">{{ child.children.length }} pages</span>
                  }
                  <svg gd-icon name="chevron-right" [size]="14" class="faint"></svg>
                </button>
              }
            </div>
          </div>
        </div>
      </div>
    } @else {
      <gd-empty-state title="This folder has no pages"><svg icon gd-icon name="folder" [size]="20"></svg></gd-empty-state>
    }
  `,
})
export class FolderPage {
  readonly path = input.required<string>();
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  protected readonly wiki = inject(WikiActions);
  protected readonly node = computed(() => findPage(this.session.snapshot()?.wiki ?? [], this.path())?.node ?? null);
  protected readonly key = nodeKey;

  protected async writeOverview() {
    const page = await this.session.run(() => this.api.content.createPage(`${this.path()}.md`));
    if (!page) return;
    this.session.contentChanged();
    await this.wiki.openPage(page.path, { replace: true });
  }
}
