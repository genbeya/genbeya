import { CdkDrag, CdkDropList, CdkDropListGroup, type CdkDragDrop } from "@angular/cdk/drag-drop";
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";
import { LucidePlus } from "@lucide/angular";
import type { Task } from "../../../../contracts/model";
import { TaskCard } from "./task-card";
import { StatusIcon } from "./task-icons";
import { titleCase } from "./task-model";

/** One column per state; cards move between columns by drag and drop. */
@Component({
  selector: "gd-task-board",
  imports: [CdkDrag, CdkDropList, CdkDropListGroup, LucidePlus, StatusIcon, TaskCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "board" },
  template: `
    <ng-container cdkDropListGroup>
      @for (status of columns(); track status) {
        @let configured = statuses().includes(status);
        @let cards = byStatus().get(status) ?? [];
        <section
          class="board-column"
          role="region"
          [attr.aria-label]="titleCase(status)"
          [class.is-over]="over() === status"
          cdkDropList
          cdkDropListSortingDisabled
          [cdkDropListData]="status"
          [cdkDropListEnterPredicate]="accepts(configured)"
          (cdkDropListEntered)="over.set(status)"
          (cdkDropListExited)="over.set(null)"
          (cdkDropListDropped)="drop($event)"
        >
          <header class="board-column-header">
            <gd-status-icon [status]="status" [statuses]="statuses()" />
            <strong>{{ titleCase(status) }}</strong>
            <span class="faint">{{ cards.length }}</span>
            <span class="grow"></span>
            @if (configured) {
              <button type="button" class="icon-btn" [attr.aria-label]="'New task in ' + titleCase(status)" [title]="'New task in ' + titleCase(status)" (click)="create.emit(status)">
                <svg lucidePlus [size]="14" aria-hidden="true"></svg>
              </button>
            }
          </header>
          @if (!configured) {
            <p class="column-note">Not a configured state. Move tasks out of it.</p>
          }
          <div class="board-cards">
            @for (task of cards; track task.path) {
              <gd-task-card
                cdkDrag
                [cdkDragData]="task"
                role="button"
                tabindex="0"
                [task]="task"
                [selected]="task.id === selected()"
                (click)="open.emit(task)"
                (keydown.enter)="open.emit(task)"
                (keydown.space)="$event.preventDefault(); open.emit(task)"
              />
            }
          </div>
        </section>
      }
    </ng-container>
  `,
})
export class TaskBoard {
  readonly columns = input.required<readonly string[]>();
  readonly statuses = input.required<readonly string[]>();
  readonly tasks = input.required<readonly Task[]>();
  readonly selected = input<string>();
  readonly open = output<Task>();
  readonly move = output<{ task: Task; status: string }>();
  readonly create = output<string>();
  protected readonly titleCase = titleCase;
  protected readonly over = signal<string | null>(null);
  protected readonly byStatus = computed(() => {
    const groups = new Map<string, Task[]>();
    for (const task of this.tasks()) groups.set(task.status, [...(groups.get(task.status) ?? []), task]);
    return groups;
  });

  /** Only configured states take cards. */
  protected accepts(configured: boolean): () => boolean {
    return () => configured;
  }

  protected drop(event: CdkDragDrop<string, string, Task>) {
    this.over.set(null);
    if (event.container !== event.previousContainer) this.move.emit({ task: event.item.data, status: event.container.data });
  }
}
