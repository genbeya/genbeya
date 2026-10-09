import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, input, signal, viewChild } from "@angular/core";
import { LucideFilePlus2, LucideFileText, LucideFolder, LucidePlus, LucideSearch } from "@lucide/angular";
import type { WikiNode } from "../../../../contracts/model";
import { hotkey } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { filterTree, Tree, type TreeItem } from "../../ui/tree";
import { PageMenu } from "./page-menu";
import { WikiActions } from "./wiki-actions";
import { nodeKey } from "./wiki-pages";

/** The page tree with its filter; `/` focuses the filter. */
@Component({
  selector: "gd-page-tree",
  imports: [Tree, PageMenu, LucideFilePlus2, LucideFileText, LucideFolder, LucidePlus, LucideSearch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <div class="row panel-toolbar">
      <label class="filter grow">
        <svg lucideSearch [size]="13" aria-hidden="true"></svg>
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
        <svg lucideFilePlus2 [size]="15" aria-hidden="true"></svg>
      </button>
    </div>
    <div class="side-panel-scroll">
      <gd-tree
        label="Pages"
        [items]="shown()"
        [selected]="selected()"
        [expandAll]="!!query()"
        [initiallyOpen]="topLevel"
        (selectItem)="open($event)"
      >
        <ng-template let-item>
          <span class="tree-icon">
            @if (item.data.path) {
              <svg lucideFileText [size]="14" aria-hidden="true"></svg>
            } @else {
              <svg lucideFolder [size]="14" aria-hidden="true"></svg>
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
              <svg lucidePlus [size]="13" aria-hidden="true"></svg>
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
