import { ChangeDetectionStrategy, Component, computed, inject, input, output } from "@angular/core";
import type { FieldDefinition, FieldValue, TaskInput } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { titleCase } from "./task-model";

export interface FieldChange {
  readonly name: string;
  readonly value: FieldValue;
}

/**
 * The custom fields of a task: an editor per field the settings configure,
 * then the task's other frontmatter fields, which are only shown. A change is
 * emitted for its field alone, an emptied field as "", so changes made in
 * quick succession each apply to the newest version of the task.
 */
@Component({
  selector: "gd-task-fields",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-fields", "[hidden]": "!definitions().length && !others().length" },
  template: `
    @for (field of definitions(); track field.name) {
      @let current = values()[field.name] ?? "";
      @let id = "task-field-" + field.name;
      <div class="task-field">
        <label class="task-field-name ellipsis" [for]="id">{{ titleCase(field.name) }}</label>
        @switch (field.type) {
          @case ("choice") {
            <select class="select" [id]="id" (change)="set(field.name, $any($event.target).value)">
              <option value="" [selected]="current === ''">—</option>
              @for (option of optionsOf(field, current); track option) {
                <option [value]="option" [selected]="option === current">{{ option }}</option>
              }
            </select>
          }
          @case ("number") {
            <input class="input" type="number" [id]="id" [value]="current" (change)="setNumber(field.name, $any($event.target))" />
          }
          @case ("date") {
            <input class="input" type="date" [id]="id" [value]="current" (change)="setDate(field.name, $any($event.target).value)" />
          }
          @default {
            <input
              class="input"
              [id]="id"
              [value]="current"
              (change)="set(field.name, $any($event.target).value)"
              (keydown.enter)="$any($event.target).blur()"
            />
          }
        }
      </div>
    }
    @for (entry of others(); track entry.name) {
      <div class="task-field" title="Add this field in Settings to edit it here.">
        <span class="task-field-name ellipsis">{{ entry.name }}</span>
        <span class="task-field-value selectable">{{ entry.value }}</span>
      </div>
    }
  `,
})
export class TaskFields {
  readonly value = input.required<TaskInput>();
  readonly changed = output<FieldChange>();
  private readonly session = inject(Session);
  protected readonly titleCase = titleCase;
  protected readonly definitions = computed(() => this.session.snapshot()!.settings.fields);
  protected readonly values = computed(() => this.value().fields ?? {});
  /** Fields of the task that the settings do not configure. */
  protected readonly others = computed(() =>
    Object.entries(this.values())
      .filter(([name]) => !this.definitions().some((field) => field.name === name))
      .map(([name, value]) => ({ name, value })),
  );

  /** A value that is not one of the options stays selectable, so showing it changes nothing. */
  protected optionsOf(field: FieldDefinition, current: FieldValue): readonly string[] {
    const options = field.options ?? [];
    return current === "" || options.includes(String(current)) ? options : [...options, String(current)];
  }

  protected setNumber(name: string, field: HTMLInputElement) {
    this.set(name, field.value === "" || Number.isNaN(field.valueAsNumber) ? "" : field.valueAsNumber);
  }

  /**
   * A date counts once it is whole: typing the year digit by digit reports
   * 0002, 0020 and 0202 first, which are not meant. Cleared is "".
   */
  protected setDate(name: string, value: string) {
    if (!value || Number(value.slice(0, 4)) >= 1000) this.set(name, value);
  }

  protected set(name: string, value: FieldValue) {
    if ((this.values()[name] ?? "") !== value) this.changed.emit({ name, value });
  }
}
