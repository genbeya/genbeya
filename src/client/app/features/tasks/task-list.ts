import { CdkContextMenuTrigger } from "@angular/cdk/menu";
import { afterNextRender, ChangeDetectionStrategy, Component, computed, inject, Injector, input, output } from "@angular/core";
import { LucideFolder } from "@lucide/angular";
import type { Task } from "../../../../contracts/model";
import { Avatar } from "../../ui/avatar";
import { ShareMenu } from "../share/share-menu";
import { LabelChip, PriorityIcon, StatusIcon, TypeIcon } from "./task-icons";
import { displayId, titleCase } from "./task-model";

/**
 * Tasks as rows, grouped by state. Every configured state is listed, even
 * without tasks, with a checkbox that shows or hides its board column.
 */
@Component({
  selector: "gd-task-list",
  imports: [Avatar, CdkContextMenuTrigger, LabelChip, PriorityIcon, ShareMenu, StatusIcon, TypeIcon, LucideFolder],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-list" },
  template: `
    <gd-share-menu #share="gdShareMenu" />
    @for (group of groups(); track group.status) {
      @let configured = statuses().includes(group.status);
      <section [attr.aria-label]="titleCase(group.status)">
        <header class="task-list-group">
          @if (configured) {
            <input
              type="checkbox"
              class="column-toggle"
              [checked]="!hidden().includes(group.status)"
              [attr.aria-label]="'Show ' + titleCase(group.status) + ' on the board'"
              [title]="hidden().includes(group.status) ? 'Hidden on the board' : 'Shown on the board'"
              (change)="toggle(group.status, $any($event.target))"
            />
          } @else {
            <span class="column-toggle"></span>
          }
          <gd-status-icon [status]="group.status" [statuses]="statuses()" [iconName]="statusIcons()[group.status]" />
          <strong>{{ titleCase(group.status) }}</strong>
          <span class="faint">{{ group.tasks.length }}</span>
        </header>
        @for (task of group.tasks; track task.path) {
          <div
            class="task-row"
            role="button"
            tabindex="0"
            [class.is-selected]="task.id === selected()"
            [cdkContextMenuTriggerFor]="share.menu()"
            [cdkContextMenuTriggerData]="{ $implicit: { kind: 'task', id: task.id } }"
            (click)="open.emit(task)"
            (keydown.enter)="open.emit(task)"
            (keydown.space)="$event.preventDefault(); open.emit(task)"
          >
            <gd-priority-icon [priority]="task.priority" />
            <gd-type-icon class="type-slot" [type]="task.type" />
            <span class="task-id mono">{{ displayId(task.id) }}</span>
            <gd-status-icon [status]="task.status" [statuses]="statuses()" [iconName]="statusIcons()[task.status]" />
            <span class="task-row-title ellipsis">{{ task.title }}</span>
            <span class="grow"></span>
            @if (task.epic) {
              <span class="epic-chip" [title]="'Epic ' + task.epic"
                ><svg lucideFolder [size]="11" aria-hidden="true"></svg>{{ task.epic }}</span
              >
            }
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
  /** Icons of the states that have one. */
  readonly statusIcons = input<Readonly<Record<string, string>>>({});
  /** States the board leaves out. */
  readonly hidden = input<readonly string[]>([]);
  readonly tasks = input.required<readonly Task[]>();
  readonly selected = input<string>();
  readonly open = output<Task>();
  readonly visibilityChanged = output<{ status: string; visible: boolean }>();
  protected readonly titleCase = titleCase;
  protected readonly displayId = displayId;
  private readonly injector = inject(Injector);
  /** Configured states always, other states while tasks are in them. */
  protected readonly groups = computed(() =>
    this.columns()
      .map((status) => ({ status, tasks: this.tasks().filter((task) => task.status === status) }))
      .filter((group) => group.tasks.length || this.statuses().includes(group.status)),
  );

  /**
   * The view hides the column at once and shows it again when saving fails,
   * perhaps before it rendered it hidden; the box then follows `hidden`
   * anyway, rather than the click.
   */
  protected toggle(status: string, box: HTMLInputElement) {
    this.visibilityChanged.emit({ status, visible: box.checked });
    afterNextRender({ write: () => (box.checked = !this.hidden().includes(status)) }, { injector: this.injector });
  }
}
