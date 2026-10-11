import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";
import { Icon } from "../../ui/icon";
import { IconPicker } from "../../ui/icon-picker";
import { StatusIcon } from "../tasks/task-icons";
import { statusColor, titleCase } from "../tasks/task-model";

/** The workflow states, in board order: reorder, remove, add, and choose an icon. */
@Component({
  selector: "gd-status-editor",
  imports: [Icon, IconPicker, StatusIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "list-editor" },
  template: `
    @for (status of value(); track status; let index = $index; let first = $first; let last = $last) {
      <div class="list-item">
        <gd-icon-picker
          [value]="icons()[status] ?? null"
          [label]="'Icon of ' + titleCase(status)"
          [color]="statusColor(index, value().length)"
          noneLabel="Automatic"
          (changed)="setIcon(status, $event)"
        >
          <gd-status-icon none [status]="status" [statuses]="value()" />
        </gd-icon-picker>
        <span class="grow">{{ titleCase(status) }}</span>
        <span class="faint mono">{{ status }}</span>
        <button type="button" class="icon-btn" aria-label="Move up" title="Move up" [disabled]="first" (click)="move(index, -1)">
          <svg gd-icon name="arrow-up" [size]="13"></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="Move down" title="Move down" [disabled]="last" (click)="move(index, 1)">
          <svg gd-icon name="arrow-down" [size]="13"></svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="'Remove ' + status"
          [title]="'Remove ' + status"
          [disabled]="value().length === 1"
          (click)="remove(status)"
        >
          <svg gd-icon name="x" [size]="13"></svg>
        </button>
      </div>
    }
    <div class="row list-add">
      <input
        #field
        class="input"
        placeholder="Add a state"
        aria-label="New workflow state"
        [value]="adding()"
        (input)="adding.set(field.value)"
        (keydown.enter)="$event.preventDefault(); add()"
      />
      <button type="button" class="btn btn-default btn-m" [disabled]="!adding().trim()" (click)="add()">
        <svg gd-icon name="plus" [size]="14"></svg><span>Add</span>
      </button>
    </div>
  `,
})
export class StatusEditor {
  readonly value = input.required<readonly string[]>();
  /** Icons of the states that have one. */
  readonly icons = input<Readonly<Record<string, string>>>({});
  readonly changed = output<string[]>();
  readonly iconsChanged = output<Record<string, string>>();
  protected readonly adding = signal("");
  protected readonly titleCase = titleCase;
  protected readonly statusColor = statusColor;

  protected move(index: number, step: -1 | 1) {
    const next = [...this.value()];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    this.changed.emit(next);
  }

  protected remove(status: string) {
    this.changed.emit(this.value().filter((other) => other !== status));
  }

  /** States are stored lower-case with dashes: "In review" → "in-review". */
  protected add() {
    const name = this.adding().trim().toLowerCase().replace(/\s+/g, "-");
    if (name && !this.value().includes(name)) this.changed.emit([...this.value(), name]);
    this.adding.set("");
  }

  /** Without an icon, the state shows its progress. */
  protected setIcon(status: string, icon: string | null) {
    const others = Object.fromEntries(Object.entries(this.icons()).filter(([other]) => other !== status));
    this.iconsChanged.emit(icon ? { ...others, [status]: icon } : others);
  }
}
