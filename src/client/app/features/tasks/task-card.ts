import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { People } from "../../core/people";
import { Session } from "../../core/session";
import { today } from "../../ui/calendar-date";
import { Avatar } from "../../ui/avatar";
import { Icon } from "../../ui/icon";
import { DueDates, dueDatesOf } from "./due-dates";
import { LabelChip, PriorityIcon, TypeIcon } from "./task-icons";
import { displayId, titleCase } from "./task-model";

@Component({
  selector: "gd-task-card",
  imports: [Avatar, DueDates, Icon, LabelChip, PriorityIcon, TypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-card", "[class.is-selected]": "selected()" },
  template: `
    <div class="task-card-top">
      @if (task().type) {
        <gd-type-icon [type]="task().type" [size]="13" />
      }
      <span class="task-id mono">{{ displayId(task().id) }}</span>
      <span class="grow"></span>
      @if (task().assignee) {
        <gd-avatar [name]="assignee()" [size]="18" />
      }
    </div>
    <div class="task-card-title">{{ task().title }}</div>
    @if (task().priority !== "none" || task().labels.length || (showEpic() && task().epic) || hasDates()) {
      <div class="task-card-meta">
        @if (showEpic() && task().epic) {
          <span class="epic-chip" [title]="'Epic ' + task().epic"><svg gd-icon name="folder" [size]="11"></svg>{{ task().epic }}</span>
        }
        @if (task().priority !== "none") {
          <span class="priority-chip" [title]="titleCase(task().priority)"
            ><gd-priority-icon [priority]="task().priority" [size]="13"
          /></span>
        }
        @for (label of task().labels; track label) {
          <gd-label-chip [name]="label" />
        }
        <gd-due-dates [task]="task()" />
      </div>
    }
  `,
})
export class TaskCard {
  readonly task = input.required<Task>();
  readonly selected = input(false);
  /** Shows the task's epic; swimlanes already say it. */
  readonly showEpic = input(true);
  protected readonly displayId = displayId;
  protected readonly titleCase = titleCase;
  private readonly people = inject(People);
  private readonly session = inject(Session);
  /** The assignee's name, as mentions show them. */
  protected readonly assignee = computed(() => this.people.nameOf(this.task().assignee));
  protected readonly hasDates = computed(() => dueDatesOf(this.task(), this.session.snapshot()!.settings, today()).length > 0);
}
