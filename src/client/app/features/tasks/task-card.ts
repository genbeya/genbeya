import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { People } from "../../core/people";
import { Session } from "../../core/session";
import { today } from "../../ui/calendar-date";
import { Avatar } from "../../ui/avatar";
import { Icon } from "../../ui/icon";
import { DueDates, dueDatesOf } from "./due-dates";
import { TaskPlanning } from "./task-planning";
import { PullLinks } from "../pulls/pull-links";
import { LabelChip, PriorityIcon, TypeIcon } from "./task-icons";
import { displayId, titleCase } from "./task-model";

@Component({
  selector: "gd-task-card",
  imports: [Avatar, DueDates, Icon, LabelChip, PriorityIcon, TypeIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-card", "[class.is-selected]": "selected()" },
  styles: `
    .task-in-review {
      display: inline-flex;
      color: var(--green);
    }
  `,
  template: `
    <div class="task-card-top">
      @if (task().type) {
        <gd-type-icon [type]="task().type" [size]="13" />
      }
      <span class="task-id mono">{{ displayId(task().id) }}</span>
      @if (blockedBy(); as blockers) {
        <span class="task-blocked" [title]="'Blocked by ' + blockers" aria-label="Blocked"
          ><svg gd-icon name="lock" [size]="12"></svg
        ></span>
      }
      @if (inReview()) {
        <span class="task-in-review" title="An open pull request names this task" aria-label="In a pull request"
          ><svg gd-icon name="git-pull-request" [size]="12"></svg
        ></span>
      }
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
  private readonly planning = inject(TaskPlanning);
  /** The unfinished tasks this one waits for, while it is blocked. */
  protected readonly blockedBy = computed(() => {
    const id = this.task().id.toUpperCase();
    const { states, waitsFor } = this.planning.dependencies();
    if (states.get(id) !== "blocked") return null;
    const done = this.planning.statuses().at(-1);
    const unfinished = (waitsFor.get(id) ?? []).filter(
      (other) => this.planning.tasks().find((task) => task.id.toUpperCase() === other)?.status !== done,
    );
    return unfinished.join(", ");
  });
  private readonly pulls = inject(PullLinks);
  protected readonly inReview = computed(() => this.pulls.hasOpen(this.task().id));
  protected readonly hasDates = computed(() => dueDatesOf(this.task(), this.session.snapshot()!.settings, today()).length > 0);
}
