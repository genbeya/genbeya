import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { Avatar } from "../../ui/avatar";
import { LabelChip, PriorityIcon, StatusIcon } from "./task-icons";
import { displayId, titleCase } from "./task-model";

/** Tasks as rows, grouped by state. */
@Component({
  selector: "gd-task-list",
  imports: [Avatar, LabelChip, PriorityIcon, StatusIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-list" },
  template: `
    @for (group of groups(); track group.status) {
      <section [attr.aria-label]="titleCase(group.status)">
        <header class="task-list-group">
          <gd-status-icon [status]="group.status" [statuses]="statuses()" />
          <strong>{{ titleCase(group.status) }}</strong>
          <span class="faint">{{ group.tasks.length }}</span>
        </header>
        @for (task of group.tasks; track task.path) {
          <div class="task-row" role="button" tabindex="0" [class.is-selected]="task.id === selected()" (click)="open.emit(task)" (keydown.enter)="open.emit(task)" (keydown.space)="$event.preventDefault(); open.emit(task)">
            <gd-priority-icon [priority]="task.priority" />
            <span class="task-id mono">{{ displayId(task.id) }}</span>
            <gd-status-icon [status]="task.status" [statuses]="statuses()" />
            <span class="task-row-title ellipsis">{{ task.title }}</span>
            <span class="grow"></span>
            @for (label of task.labels; track label) {
              <gd-label-chip [name]="label" />
            }
            @if (task.assignee) {
              <gd-avatar [name]="task.assignee" [size]="20" />
            } @else {
              <span class="avatar-placeholder"></span>
            }
          </div>
        }
      </section>
    }
  `,
})
export class TaskList {
  readonly columns = input.required<readonly string[]>();
  readonly statuses = input.required<readonly string[]>();
  readonly tasks = input.required<readonly Task[]>();
  readonly selected = input<string>();
  readonly open = output<Task>();
  protected readonly titleCase = titleCase;
  protected readonly displayId = displayId;
  protected readonly groups = computed(() =>
    this.columns()
      .map((status) => ({ status, tasks: this.tasks().filter((task) => task.status === status) }))
      .filter((group) => group.tasks.length),
  );
}
