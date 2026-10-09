import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";
import { LucideArrowDown, LucideArrowUp, LucidePlus, LucideX } from "@lucide/angular";
import { StatusIcon } from "../tasks/task-icons";
import { titleCase } from "../tasks/task-model";

/** The workflow states, in board order: reorder, remove, add. */
@Component({
  selector: "gd-status-editor",
  imports: [StatusIcon, LucideArrowDown, LucideArrowUp, LucidePlus, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "status-editor" },
  template: `
    @for (status of value(); track status; let index = $index; let first = $first; let last = $last) {
      <div class="status-item">
        <gd-status-icon [status]="status" [statuses]="value()" />
        <span class="grow">{{ titleCase(status) }}</span>
        <span class="faint mono">{{ status }}</span>
        <button type="button" class="icon-btn" aria-label="Move up" title="Move up" [disabled]="first" (click)="move(index, -1)"><svg lucideArrowUp [size]="13" aria-hidden="true"></svg></button>
        <button type="button" class="icon-btn" aria-label="Move down" title="Move down" [disabled]="last" (click)="move(index, 1)"><svg lucideArrowDown [size]="13" aria-hidden="true"></svg></button>
        <button type="button" class="icon-btn" [attr.aria-label]="'Remove ' + status" [title]="'Remove ' + status" [disabled]="value().length === 1" (click)="remove(status)">
          <svg lucideX [size]="13" aria-hidden="true"></svg>
        </button>
      </div>
    }
    <div class="row status-add">
      <input #field class="input" placeholder="Add a state" aria-label="New workflow state" [value]="adding()" (input)="adding.set(field.value)" (keydown.enter)="$event.preventDefault(); add()" />
      <button type="button" class="btn btn-default btn-m" [disabled]="!adding().trim()" (click)="add()"><svg lucidePlus [size]="14" aria-hidden="true"></svg><span>Add</span></button>
    </div>
  `,
})
export class StatusEditor {
  readonly value = input.required<readonly string[]>();
  readonly changed = output<string[]>();
  protected readonly adding = signal("");
  protected readonly titleCase = titleCase;

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
}
