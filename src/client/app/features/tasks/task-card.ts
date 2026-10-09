import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { Avatar } from "../../ui/avatar";
import { LabelChip, PriorityIcon } from "./task-icons";
import { displayId, titleCase } from "./task-model";

@Component({
  selector: "gd-task-card",
  imports: [Avatar, LabelChip, PriorityIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-card", "[class.is-selected]": "selected()" },
  template: `
    <div class="task-card-top">
      <span class="task-id mono">{{ displayId(task().id) }}</span>
      @if (task().assignee) {
        <gd-avatar [name]="task().assignee" [size]="18" />
      }
    </div>
    <div class="task-card-title">{{ task().title }}</div>
    @if (task().priority !== "none" || task().labels.length) {
      <div class="task-card-meta">
        @if (task().priority !== "none") {
          <span class="priority-chip" [title]="titleCase(task().priority)"><gd-priority-icon [priority]="task().priority" [size]="13" /></span>
        }
        @for (label of task().labels; track label) {
          <gd-label-chip [name]="label" />
        }
      </div>
    }
  `,
})
export class TaskCard {
  readonly task = input.required<Task>();
  readonly selected = input(false);
  protected readonly displayId = displayId;
  protected readonly titleCase = titleCase;
}
