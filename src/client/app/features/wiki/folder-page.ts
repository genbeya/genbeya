import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { LucideChevronRight, LucideFilePlus2, LucideFileText, LucideFolder } from "@lucide/angular";
import type { WikiNode } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { EmptyState } from "../../ui/empty-state";
import { Breadcrumbs } from "./breadcrumbs";
import { WikiActions } from "./wiki-actions";
import { findPage, nodeKey } from "./wiki-pages";

/** A folder without its own page: its pages as cards, and an offer to write an overview. */
@Component({
  selector: "gd-folder-page",
  imports: [Breadcrumbs, EmptyState, LucideChevronRight, LucideFilePlus2, LucideFileText, LucideFolder],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    @if (node(); as folder) {
      <header class="view-header">
        <gd-breadcrumbs [path]="path()" />
        <span class="grow"></span>
        <button type="button" class="btn btn-default btn-m" (click)="writeOverview()">
          <svg lucideFilePlus2 [size]="14" aria-hidden="true"></svg><span>Write an overview page</span>
        </button>
      </header>
      <div class="content-scroll">
        <div class="document">
          <div class="document-article">
            <h1 class="folder-title">{{ folder.title }}</h1>
            <div class="folder-list">
              @for (child of folder.children; track key(child)) {
                <button type="button" class="folder-card" (click)="open(child)">
                  @if (child.path) {
                    <svg lucideFileText [size]="16" aria-hidden="true"></svg>
                  } @else {
                    <svg lucideFolder [size]="16" aria-hidden="true"></svg>
                  }
                  <span class="grow">{{ child.title }}</span>
                  @if (child.children.length) {
                    <span class="faint">{{ child.children.length }} pages</span>
                  }
                  <svg lucideChevronRight [size]="14" class="faint" aria-hidden="true"></svg>
                </button>
              }
            </div>
          </div>
        </div>
      </div>
    } @else {
      <gd-empty-state title="This folder has no pages"><svg icon lucideFolder [size]="20" aria-hidden="true"></svg></gd-empty-state>
    }
  `,
})
export class FolderPage {
  readonly path = input.required<string>();
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly wiki = inject(WikiActions);
  protected readonly node = computed(() => findPage(this.session.snapshot()?.wiki ?? [], this.path())?.node ?? null);
  protected readonly key = nodeKey;

  protected open(node: WikiNode) {
    if (node.path) void this.wiki.openPage(node.path);
    else if (node.folder) void this.wiki.openFolder(node.folder);
  }

  protected async writeOverview() {
    const page = await this.session.run(() => this.api.content.createPage(`${this.path()}.md`));
    if (!page) return;
    this.session.contentChanged();
    await this.wiki.openPage(page.path, { replace: true });
  }
}
