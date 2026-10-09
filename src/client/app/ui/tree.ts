import { NgTemplateOutlet } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, contentChild, input, output, signal, TemplateRef } from "@angular/core";
import { LucideChevronRight } from "@lucide/angular";

export interface TreeItem<T = unknown> {
  readonly key: string;
  readonly label: string;
  readonly children?: readonly TreeItem<T>[];
  /** False for rows that only expand (folders without a page). */
  readonly selectable?: boolean;
  readonly title?: string;
  readonly data: T;
}

/** Keeps items whose label, or a descendant's, contains the query. */
export function filterTree<T>(items: readonly TreeItem<T>[], query: string): TreeItem<T>[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  return items.flatMap((item) => {
    if (item.label.toLowerCase().includes(needle)) return [item];
    const children = item.children ? filterTree(item.children, needle) : [];
    return children.length ? [{ ...item, children }] : [];
  });
}

/**
 * A keyboard-friendly tree. Rows render through the projected
 * `<ng-template let-item>`. Ancestors of the selection open by themselves
 * unless the user closed them; `expandAll` opens everything (while filtering).
 */
@Component({
  selector: "gd-tree",
  imports: [NgTemplateOutlet, LucideChevronRight],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "tree", role: "tree", "[attr.aria-label]": "label()" },
  template: `
    <ng-template #level let-items let-depth="depth">
      @for (item of items; track item.key) {
        @let open = isOpen(item);
        @let parent = !!item.children?.length;
        <div
          role="treeitem"
          class="tree-row"
          [class.is-selected]="item.key === selected()"
          [attr.aria-selected]="item.key === selected()"
          [attr.aria-expanded]="parent ? open : null"
          [attr.tabindex]="item.key === selected() || (!selected() && $first && depth === 0) ? 0 : -1"
          [attr.title]="item.title ?? null"
          [style.padding-left.px]="6 + depth * 14"
          (click)="click($event, item)"
          (keydown)="key($event, item, open)"
        >
          <span class="tree-twisty" [class.is-leaf]="!parent" [class.is-open]="open">
            @if (parent) {
              <svg lucideChevronRight [size]="12" aria-hidden="true"></svg>
            }
          </span>
          <ng-container *ngTemplateOutlet="row(); context: { $implicit: item }" />
        </div>
        @if (parent && open) {
          <div role="group">
            <ng-container *ngTemplateOutlet="level; context: { $implicit: item.children, depth: depth + 1 }" />
          </div>
        }
      }
    </ng-template>
    <ng-container *ngTemplateOutlet="level; context: { $implicit: items(), depth: 0 }" />
  `,
})
export class Tree<T> {
  readonly items = input.required<readonly TreeItem<T>[]>();
  readonly selected = input<string | null>(null);
  readonly expandAll = input(false);
  readonly label = input.required<string>();
  /** Opens matching items initially, e.g. the folders of the current page. */
  readonly initiallyOpen = input<(item: TreeItem<T>) => boolean>(() => false);
  readonly selectItem = output<TreeItem<T>>();
  protected readonly row = contentChild.required(TemplateRef);
  private readonly toggled = signal<ReadonlyMap<string, boolean>>(new Map());

  private readonly ancestors = computed(() => {
    const trail = new Set<string>();
    const selected = this.selected();
    const walk = (items: readonly TreeItem<T>[], path: string[]): boolean =>
      items.some((item) => {
        if (item.key === selected) {
          path.forEach((key) => trail.add(key));
          return true;
        }
        return !!item.children && walk(item.children, [...path, item.key]);
      });
    if (selected) walk(this.items(), []);
    return trail;
  });

  protected isOpen(item: TreeItem<T>): boolean {
    return this.expandAll() || (this.toggled().get(item.key) ?? (this.ancestors().has(item.key) || this.initiallyOpen()(item)));
  }

  protected toggle(event: Event | null, item: TreeItem<T>): void {
    event?.stopPropagation();
    const open = this.isOpen(item);
    this.toggled.update((map) => new Map(map).set(item.key, !open));
  }

  /** The twisty only toggles; the rest of the row activates. */
  protected click(event: MouseEvent, item: TreeItem<T>): void {
    if (item.children?.length && (event.target as Element).closest(".tree-twisty")) this.toggle(null, item);
    else this.activate(item);
  }

  protected activate(item: TreeItem<T>): void {
    if (item.selectable === false) this.toggle(null, item);
    else this.selectItem.emit(item);
  }

  protected key(event: KeyboardEvent, item: TreeItem<T>, open: boolean): void {
    const parent = !!item.children?.length;
    if (event.key === "Enter") this.activate(item);
    else if (event.key === "ArrowRight" && parent && !open) this.toggle(null, item);
    else if (event.key === "ArrowLeft" && parent && open) this.toggle(null, item);
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const rows = [...(event.currentTarget as HTMLElement).closest("gd-tree")!.querySelectorAll<HTMLElement>(".tree-row")];
      rows[rows.indexOf(event.currentTarget as HTMLElement) + (event.key === "ArrowDown" ? 1 : -1)]?.focus();
    }
  }
}
