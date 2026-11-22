import { ChangeDetectionStrategy, Component, computed, inject, input, output } from "@angular/core";
import type { FieldDefinition, FieldValue, TaskInput } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { parseEffort } from "../../../../utilities/planning";
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
          @case ("effort") {
            <input
              class="input"
              [id]="id"
              [value]="current"
              placeholder="16h or 2d"
              [attr.aria-invalid]="current !== '' && !isEffort(current)"
              title="Hours or days of work, such as 16h or 2d"
              (change)="setEffort(field.name, $any($event.target))"
              (keydown.enter)="$any($event.target).blur()"
            />
          }
          @case ("tasks") {
            <input
              class="input"
              [id]="id"
              [value]="listText(current)"
              placeholder="GENBEYA-12, GENBEYA-14"
              title="Task IDs, separated by commas"
              (change)="setTasks(field.name, $any($event.target).value)"
              (keydown.enter)="$any($event.target).blur()"
            />
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
        <span class="task-field-value selectable">{{ listText(entry.value) }}</span>
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

  protected readonly isEffort = (value: FieldValue) => parseEffort(value) !== null;
  protected readonly listText = (value: FieldValue) => (Array.isArray(value) ? value.join(", ") : String(value));

  /** Effort as typed, once it reads as hours or days; anything else stays in the field, marked, unsaved. */
  protected setEffort(name: string, field: HTMLInputElement) {
    const value = field.value.trim();
    if (!value || parseEffort(value) !== null) this.set(name, value);
  }

  /** Task IDs separated by commas or spaces, as a list; none clears the field. */
  protected setTasks(name: string, text: string) {
    const ids = [
      ...new Set(
        text
          .split(/[\s,]+/)
          .map((id) => id.trim().toUpperCase())
          .filter(Boolean),
      ),
    ];
    this.set(name, ids.length ? ids : "");
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
    if (JSON.stringify(this.values()[name] ?? "") !== JSON.stringify(value)) this.changed.emit({ name, value });
  }
}
