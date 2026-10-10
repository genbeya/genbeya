import { CdkDrag, CdkDropList } from "@angular/cdk/drag-drop";
import { CdkContextMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { ShareMenu } from "../share/share-menu";
import { TaskCard } from "./task-card";

/**
 * The cards of one board column, or of one column within a swimlane. The
 * cell is the drop list, so its cards find it when dragged.
 */
@Component({
  selector: "gd-board-cell",
  imports: [CdkContextMenuTrigger, CdkDrag, ShareMenu, TaskCard],
  hostDirectives: [
    {
      directive: CdkDropList,
      inputs: ["cdkDropListData", "cdkDropListEnterPredicate", "cdkDropListSortingDisabled"],
      outputs: ["cdkDropListDropped", "cdkDropListEntered", "cdkDropListExited"],
    },
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "board-cards" },
  template: `
    @if (!configured()) {
      <p class="column-note">Not a configured state. Move tasks out of it.</p>
    }
    <gd-share-menu #share="gdShareMenu" />
    @for (task of tasks(); track task.path) {
      <gd-task-card
        cdkDrag
        [cdkDragData]="task"
        [cdkContextMenuTriggerFor]="share.menu()"
        [cdkContextMenuTriggerData]="{ $implicit: { kind: 'task', id: task.id } }"
        role="button"
        tabindex="0"
        [task]="task"
        [showEpic]="showEpic()"
        [selected]="task.id === selected()"
        (click)="open.emit(task)"
        (keydown.enter)="open.emit(task)"
        (keydown.space)="$event.preventDefault(); open.emit(task)"
      />
    }
  `,
})
export class BoardCell {
  readonly tasks = input.required<readonly Task[]>();
  readonly configured = input(true);
  readonly showEpic = input(true);
  readonly selected = input<string>();
  readonly open = output<Task>();
}
