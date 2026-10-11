import { CdkContextMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal, type TemplateRef } from "@angular/core";
import type { Change } from "../../../../contracts/model";
import { Icon } from "../../ui/icon";
import { changeTree, type ChangeNode } from "./change-nodes";
import { ChangeRow } from "./change-row";
import type { ChangeTarget } from "./change-target";

interface Row {
  readonly key: string;
  readonly node: ChangeNode;
  readonly level: number;
  readonly open: boolean;
  /** The index of the folder row it is in; -1 at the top. */
  readonly parent: number;
}

const keyOf = (node: ChangeNode) => (node.kind === "folder" ? `folder:${node.path}` : `file:${node.change.path}`);

/**
 * Changed files in their folders, with folders that open and close and act
 * on everything in them. A tree as ARIA describes it: one row is tabbable,
 * the arrows move between rows, Right and Left open and close folders or
 * go to the first child and the parent, Home and End to the first and last
 * row, Enter or Space selects a file or toggles a folder.
 */
@Component({
  selector: "gd-change-tree",
  imports: [CdkContextMenuTrigger, ChangeRow, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./change-tree.css",
  host: { role: "tree", class: "change-tree", "[attr.aria-label]": "label()", "(focusin)": "focused($event)" },
  template: `
    @for (row of rows(); track row.key) {
      @if (row.node.kind === "folder") {
        <div
          role="treeitem"
          class="change-folder"
          data-tree-row
          [attr.aria-level]="row.level"
          [attr.aria-expanded]="row.open"
          aria-selected="false"
          [attr.tabindex]="row.key === tabbable() ? 0 : -1"
          [style.padding-left.px]="4 + row.level * 14"
          [title]="row.node.path"
          [cdkContextMenuTriggerFor]="menu()"
          [cdkContextMenuTriggerData]="{ $implicit: target(row.node) }"
          [cdkContextMenuDisabled]="!menu()"
          (click)="toggle(row.node.path)"
          (keydown)="key($event)"
        >
          <span class="tree-twisty" [class.is-open]="row.open"><svg gd-icon name="chevron-right" [size]="12"></svg></span>
          <span class="change-name ellipsis">{{ row.node.label }}</span>
          <span class="change-actions">
            @if (!staged()) {
              <button
                type="button"
                class="icon-btn"
                tabindex="-1"
                [attr.aria-label]="'Discard changes in ' + row.node.path"
                title="Discard changes"
                (click)="$event.stopPropagation(); discard.emit(target(row.node))"
              >
                <svg gd-icon name="undo-2" [size]="13"></svg>
              </button>
            }
            <button
              type="button"
              class="icon-btn"
              tabindex="-1"
              [attr.aria-label]="(staged() ? 'Unstage ' : 'Stage ') + row.node.path"
              [title]="staged() ? 'Unstage folder' : 'Stage folder'"
              (click)="$event.stopPropagation(); toggleStaged.emit(target(row.node))"
            >
              <svg gd-icon [name]="staged() ? 'minus' : 'plus'" [size]="13"></svg>
            </button>
          </span>
          <span class="count" [attr.aria-label]="row.node.changes.length + ' changes'">{{ row.node.changes.length }}</span>
        </div>
      } @else {
        <gd-change-row
          data-tree-row
          [change]="row.node.change"
          [staged]="staged()"
          [selected]="row.node.change.path === selected()"
          [level]="row.level"
          [tabbable]="row.key === tabbable()"
          [cdkContextMenuTriggerFor]="menu()"
          [cdkContextMenuTriggerData]="{ $implicit: target(row.node) }"
          [cdkContextMenuDisabled]="!menu()"
          (keydown)="key($event)"
          (chosen)="chosen.emit(row.node.change)"
          (openFile)="openFile.emit(row.node.change)"
          (toggleStaged)="toggleStaged.emit(target(row.node))"
          (discard)="discard.emit(target(row.node))"
        />
      }
    }
  `,
})
export class ChangeTree {
  readonly changes = input.required<readonly Change[]>();
  readonly staged = input.required<boolean>();
  readonly label = input.required<string>();
  /** The selected file's path. */
  readonly selected = input<string | null>(null);
  /** The context menu of rows, given the row's {@link ChangeTarget}. */
  readonly menu = input<TemplateRef<unknown> | null>(null);
  readonly chosen = output<Change>();
  readonly openFile = output<Change>();
  readonly toggleStaged = output<ChangeTarget>();
  readonly discard = output<ChangeTarget>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly closed = signal<ReadonlySet<string>>(new Set());
  private readonly focusedKey = signal<string | null>(null);

  protected readonly rows = computed(() => {
    const rows: Row[] = [];
    const closed = this.closed();
    const walk = (nodes: readonly ChangeNode[], level: number, parent: number) => {
      for (const node of nodes) {
        const open = node.kind === "folder" && !closed.has(node.path);
        rows.push({ key: keyOf(node), node, level, open, parent });
        if (node.kind === "folder" && open) walk(node.children, level + 1, rows.length - 1);
      }
    };
    walk(changeTree(this.changes()), 1, -1);
    return rows;
  });

  /** The row Tab reaches: the one focused last, else the selected file, else the first. */
  protected readonly tabbable = computed(() => {
    const keys = this.rows().map((row) => row.key);
    const focused = this.focusedKey();
    if (focused && keys.includes(focused)) return focused;
    const selected = `file:${this.selected()}`;
    return keys.includes(selected) ? selected : (keys[0] ?? null);
  });

  protected target(node: ChangeNode): ChangeTarget {
    return node.kind === "folder"
      ? { path: node.path, folder: true, changes: node.changes, staged: this.staged() }
      : { path: node.change.path, folder: false, changes: [node.change], staged: this.staged() };
  }

  protected toggle(path: string, open?: boolean): void {
    this.closed.update((closed) => {
      const next = new Set(closed);
      if (open ?? next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  protected focused(event: FocusEvent): void {
    const element = (event.target as Element).closest<HTMLElement>("[data-tree-row]");
    const index = element ? this.elements().indexOf(element) : -1;
    if (index >= 0) this.focusedKey.set(this.rows()[index]!.key);
  }

  private elements(): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>("[data-tree-row]")];
  }

  private focus(index: number): void {
    this.elements()[index]?.focus();
  }

  protected key(event: KeyboardEvent): void {
    const element = (event.target as Element).closest<HTMLElement>("[data-tree-row]");
    const elements = this.elements();
    const index = element ? elements.indexOf(element) : -1;
    const row = this.rows()[index];
    if (!row) return;
    const folder = row.node.kind === "folder" ? row.node : null;
    switch (event.key) {
      case "ArrowDown":
        this.focus(index + 1);
        break;
      case "ArrowUp":
        this.focus(index - 1);
        break;
      case "Home":
        this.focus(0);
        break;
      case "End":
        this.focus(elements.length - 1);
        break;
      case "ArrowRight":
        if (folder && !row.open) this.toggle(folder.path, true);
        else if (folder) this.focus(index + 1);
        break;
      case "ArrowLeft":
        if (folder && row.open) this.toggle(folder.path, false);
        else if (row.parent >= 0) this.focus(row.parent);
        break;
      case "Enter":
      case " ":
        // Files select themselves.
        if (!folder) return;
        this.toggle(folder.path);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
}
