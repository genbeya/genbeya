import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, input, signal, viewChild } from "@angular/core";
import type { LinkItem } from "../../../../contracts/genbeya-link";
import type { WikiNode } from "../../../../contracts/model";
import { hotkey } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { Icon } from "../../ui/icon";
import { filterTree, Tree, type TreeItem } from "../../ui/tree";
import { ShareMenu } from "../share/share-menu";
import { PageMenu } from "./page-menu";
import { WikiActions } from "./wiki-actions";
import { nodeKey } from "./wiki-pages";

/** The page tree with its filter; `/` focuses the filter. */
@Component({
  selector: "gd-page-tree",
  imports: [Icon, PageMenu, ShareMenu, Tree],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <div class="row panel-toolbar">
      <label class="filter grow">
        <svg gd-icon name="search" [size]="13"></svg>
        <input
          #filter
          placeholder="Filter pages"
          aria-label="Filter pages"
          [value]="query()"
          (input)="query.set(filter.value)"
          (keydown.escape)="clear(filter)"
        />
      </label>
      <button type="button" class="icon-btn" aria-label="New page (N)" title="New page (N)" (click)="wiki.createPage()">
        <svg gd-icon name="file-plus-2" [size]="15"></svg>
      </button>
    </div>
    <div class="side-panel-scroll">
      <gd-share-menu #share="gdShareMenu" />
      <gd-tree
        label="Pages"
        [items]="shown()"
        [selected]="selected()"
        [expandAll]="!!query()"
        [initiallyOpen]="topLevel"
        [rowMenu]="share.menu()"
        [rowMenuData]="pageLink"
        (selectItem)="open($event)"
      >
        <ng-template let-item>
          <span class="tree-icon">
            @if (item.data.path) {
              <svg gd-icon name="file-text" [size]="14"></svg>
            } @else {
              <svg gd-icon name="folder" [size]="14"></svg>
            }
          </span>
          <span class="tree-label">{{ item.label }}</span>
          <span class="tree-actions">
            <button
              type="button"
              class="icon-btn"
              [attr.aria-label]="'New page in ' + item.label"
              [title]="'New page in ' + item.label"
              (click)="$event.stopPropagation(); wiki.createPage(item.data.path ?? item.data.folder + '.md')"
            >
              <svg gd-icon name="plus" [size]="13"></svg>
            </button>
            @if (item.data.path) {
              <gd-page-menu [path]="item.data.path" [compact]="true" />
            }
          </span>
        </ng-template>
      </gd-tree>
      @if (query() && !shown().length) {
        <p class="tree-empty">No pages match.</p>
      }
    </div>
  `,
})
export class PageTree {
  /** The open page, or `folder:<path>` for a folder. */
  readonly selected = input<string | null>(null);
  protected readonly wiki = inject(WikiActions);
  private readonly session = inject(Session);
  protected readonly query = signal("");
  private readonly filter = viewChild.required<ElementRef<HTMLInputElement>>("filter");

  private readonly items = computed(() => {
    const convert = (nodes: readonly WikiNode[]): TreeItem<WikiNode>[] =>
      nodes.map((node) => ({ key: nodeKey(node), label: node.title, data: node, children: convert(node.children) }));
    return convert(this.session.snapshot()?.wiki ?? []);
  });
  protected readonly shown = computed(() => filterTree(this.items(), this.query()));
  /** Top-level pages open initially, to show the wiki's sections. */
  protected readonly topLevel = (item: TreeItem<WikiNode>) => {
    const root = this.session.snapshot()?.settings.wikiRoot ?? "";
    return !item.key
      .replace("folder:", "")
      .slice(root.length + 1)
      .includes("/");
  };

  /** Pages can be shared; folders without a page cannot. */
  protected readonly pageLink = ({ data }: TreeItem<WikiNode>): LinkItem | null => (data.path ? { kind: "page", path: data.path } : null);

  constructor() {
    hotkey("/", () => this.filter().nativeElement.focus());
  }

  protected open(item: TreeItem<WikiNode>) {
    void this.wiki.openNode(item.data);
  }

  protected clear(field: HTMLInputElement) {
    this.query.set("");
    field.blur();
  }
}
