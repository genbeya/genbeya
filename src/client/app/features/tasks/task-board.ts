import { CdkDropListGroup, type CdkDragDrop } from "@angular/cdk/drag-drop";
import { NgTemplateOutlet } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { Icon } from "../../ui/icon";
import { BoardCell } from "./board-cell";
import { StatusIcon } from "./task-icons";
import { epicName, titleCase, type Placement } from "./task-model";

/** Where a drop list sits: a column, within a swimlane when the board has them. */
interface Cell extends Placement {
  readonly configured: boolean;
}

/**
 * One column per state; cards move between columns by drag and drop. With
 * `lanes`, each epic is a swimlane across the columns, and dragging a card
 * into another lane moves it to that epic.
 */
@Component({
  selector: "gd-task-board",
  imports: [BoardCell, CdkDropListGroup, Icon, NgTemplateOutlet, StatusIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "board", "[class.has-lanes]": "!!lanes()", "[style.--columns]": "columns().length" },
  template: `
    <ng-template #header let-status>
      <header class="board-column-header">
        <gd-status-icon [status]="status" [statuses]="statuses()" [iconName]="statusIcons()[status]" />
        <strong>{{ titleCase(status) }}</strong>
        <span class="faint">{{ countIn(status) }}</span>
        <span class="grow"></span>
        @if (statuses().includes(status)) {
          <button
            type="button"
            class="icon-btn"
            [attr.aria-label]="'New task in ' + titleCase(status)"
            [title]="'New task in ' + titleCase(status)"
            (click)="create.emit({ status, epic: '' })"
          >
            <svg gd-icon name="plus" [size]="14"></svg>
          </button>
        }
      </header>
    </ng-template>

    <div class="board-grid" cdkDropListGroup>
      @if (lanes(); as lanes) {
        <div class="board-heads" role="presentation">
          @for (status of columns(); track status) {
            <div class="board-head">
              <ng-container *ngTemplateOutlet="header; context: { $implicit: status }" />
            </div>
          }
        </div>
        @for (epic of lanes; track epic) {
          @let collapsed = folded().has(epic);
          <section class="board-lane" role="group" [attr.aria-label]="epicName(epic)">
            <header class="board-lane-header">
              <button type="button" class="plain board-lane-toggle" [attr.aria-expanded]="!collapsed" (click)="fold(epic)">
                @if (collapsed) {
                  <svg gd-icon name="chevron-right" [size]="14"></svg>
                } @else {
                  <svg gd-icon name="chevron-down" [size]="14"></svg>
                }
                <strong [class.faint]="!epic">{{ epicName(epic) }}</strong>
              </button>
              <span class="faint">{{ laneCount(epic) }}</span>
              <button
                type="button"
                class="icon-btn"
                [attr.aria-label]="'New task in ' + epicName(epic)"
                [title]="'New task in ' + epicName(epic)"
                (click)="create.emit({ status: laneStatus(), epic })"
              >
                <svg gd-icon name="plus" [size]="14"></svg>
              </button>
            </header>
            @if (!collapsed) {
              <div class="board-lane-cells">
                @for (status of columns(); track status) {
                  @let cell = cellOf(status, epic);
                  <gd-board-cell
                    class="board-column board-cell"
                    role="region"
                    [attr.aria-label]="titleCase(status) + ' in ' + epicName(epic)"
                    [class.is-over]="over() === cell"
                    cdkDropListSortingDisabled
                    [cdkDropListData]="cell"
                    [cdkDropListEnterPredicate]="accepts(cell)"
                    [tasks]="cardsIn(cell)"
                    [configured]="cell.configured"
                    [showEpic]="false"
                    [selected]="selected()"
                    (open)="open.emit($event)"
                    (cdkDropListEntered)="over.set(cell)"
                    (cdkDropListExited)="over.set(null)"
                    (cdkDropListDropped)="drop($event)"
                  />
                }
              </div>
            }
          </section>
        }
      } @else {
        @for (status of columns(); track status) {
          @let cell = cellOf(status, null);
          <section class="board-column" role="region" [attr.aria-label]="titleCase(status)" [class.is-over]="over() === cell">
            <ng-container *ngTemplateOutlet="header; context: { $implicit: status }" />
            <gd-board-cell
              cdkDropListSortingDisabled
              [cdkDropListData]="cell"
              [cdkDropListEnterPredicate]="accepts(cell)"
              [tasks]="cardsIn(cell)"
              [configured]="cell.configured"
              [selected]="selected()"
              (open)="open.emit($event)"
              (cdkDropListEntered)="over.set(cell)"
              (cdkDropListExited)="over.set(null)"
              (cdkDropListDropped)="drop($event)"
            />
          </section>
        }
      }
    </div>
  `,
})
export class TaskBoard {
  readonly columns = input.required<readonly string[]>();
  readonly statuses = input.required<readonly string[]>();
  /** Icons of the states that have one. */
  readonly statusIcons = input<Readonly<Record<string, string>>>({});
  readonly tasks = input.required<readonly Task[]>();
  /** Epics as swimlanes ("" for tasks without one), or null for a board without lanes. */
  readonly lanes = input<readonly string[] | null>(null);
  readonly selected = input<string>();
  readonly open = output<Task>();
  readonly move = output<{ task: Task } & Placement>();
  readonly create = output<Placement>();
  protected readonly titleCase = titleCase;
  protected readonly epicName = epicName;
  protected readonly over = signal<Cell | null>(null);
  /** Collapsed swimlanes. */
  protected readonly folded = signal<ReadonlySet<string>>(new Set());
  /** Where a swimlane's new task starts: the first state the board shows, so the card appears. */
  protected readonly laneStatus = computed(() => this.columns().find((status) => this.statuses().includes(status)) ?? this.statuses()[0]!);

  /** Cells by status and lane, so drop list data stays the same object between renders. */
  private readonly cells = computed(() => {
    const cells = new Map<string, Cell>();
    for (const epic of this.lanes() ?? [null])
      for (const status of this.columns())
        cells.set(this.key(status, epic), { status, epic: epic ?? "", configured: this.statuses().includes(status) });
    return cells;
  });
  private readonly byCell = computed(() => {
    const lanes = !!this.lanes();
    const groups = new Map<string, Task[]>();
    for (const task of this.tasks()) {
      const key = this.key(task.status, lanes ? task.epic : null);
      groups.set(key, [...(groups.get(key) ?? []), task]);
    }
    return groups;
  });

  /** Without lanes (epic null) a column holds every epic. */
  private key(status: string, epic: string | null): string {
    return `${status}\n${epic ?? "*"}`;
  }

  protected cellOf(status: string, epic: string | null): Cell {
    return this.cells().get(this.key(status, epic))!;
  }

  protected cardsIn(cell: Cell): readonly Task[] {
    return this.byCell().get(this.key(cell.status, this.lanes() ? cell.epic : null)) ?? [];
  }

  protected countIn(status: string): number {
    return this.tasks().filter((task) => task.status === status).length;
  }

  protected laneCount(epic: string): number {
    return this.tasks().filter((task) => task.epic === epic).length;
  }

  protected fold(epic: string) {
    this.folded.update((folded) => {
      const next = new Set(folded);
      if (!next.delete(epic)) next.add(epic);
      return next;
    });
  }

  /** Only configured states take cards. */
  protected accepts(cell: Cell): () => boolean {
    return () => cell.configured;
  }

  protected drop(event: CdkDragDrop<Cell, Cell, Task>) {
    this.over.set(null);
    if (event.container === event.previousContainer) return;
    const task = event.item.data;
    const { status, epic } = event.container.data;
    // Without lanes, a card keeps its epic.
    this.move.emit({ task, status, epic: this.lanes() ? epic : task.epic });
  }
}
