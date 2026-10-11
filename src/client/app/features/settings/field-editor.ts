import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";
import { FIELD_TYPES, TASK_KEYS, type FieldDefinition, type FieldType } from "../../../../contracts/model";
import { Icon } from "../../ui/icon";
import { titleCase } from "../tasks/task-model";

/** Names are frontmatter keys, so spaces become dashes. */
const fieldName = (text: string) => text.trim().replace(/\s+/g, "-");

/** Why `name` cannot name a new field among `fields`, as Settings would refuse it on saving; null when it can. */
function fieldNameProblem(name: string, fields: readonly FieldDefinition[]): string | null {
  if (!name) return null;
  if (!/^[A-Za-z][\w-]{0,39}$/.test(name)) return "Start with a letter, then use letters, digits, - and _.";
  const lower = name.toLowerCase();
  if ((TASK_KEYS as readonly string[]).includes(lower)) return `${name} is a built-in task property.`;
  if (fields.some((field) => field.name.toLowerCase() === lower)) return `There is a field ${name} already.`;
  return null;
}

/** The custom task fields, in panel order: kind and options of each; reorder, remove, add. */
@Component({
  selector: "gd-field-editor",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "list-editor" },
  template: `
    @for (field of value(); track field.name; let index = $index; let first = $first; let last = $last) {
      <div class="list-item">
        <span class="grow mono ellipsis">{{ field.name }}</span>
        <select class="select compact" [attr.aria-label]="'Kind of ' + field.name" (change)="setType(index, $any($event.target).value)">
          @for (type of types; track type) {
            <option [value]="type" [selected]="type === field.type">{{ titleCase(type) }}</option>
          }
        </select>
        <button type="button" class="icon-btn" aria-label="Move up" title="Move up" [disabled]="first" (click)="move(index, -1)">
          <svg gd-icon name="arrow-up" [size]="13"></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="Move down" title="Move down" [disabled]="last" (click)="move(index, 1)">
          <svg gd-icon name="arrow-down" [size]="13"></svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="'Remove ' + field.name"
          [title]="'Remove ' + field.name + ' (tasks keep their values)'"
          (click)="changed.emit(without(index))"
        >
          <svg gd-icon name="x" [size]="13"></svg>
        </button>
      </div>
      @if (field.type === "choice") {
        <div class="list-item list-detail">
          <input
            #options
            class="input compact grow"
            placeholder="Options, comma-separated"
            [attr.aria-label]="'Options of ' + field.name"
            [value]="field.options?.join(', ') ?? ''"
            (change)="setOptions(index, options.value)"
          />
        </div>
      }
    }
    <div class="row list-add">
      <input
        #field
        class="input"
        placeholder="Add a field, such as estimate"
        aria-label="New field"
        [attr.aria-invalid]="!!problem()"
        [attr.aria-describedby]="problem() ? 'field-name-problem' : null"
        [value]="adding()"
        (input)="adding.set(field.value)"
        (keydown.enter)="$event.preventDefault(); add()"
      />
      <button type="button" class="btn btn-default btn-m" [disabled]="!adding().trim() || !!problem()" (click)="add()">
        <svg gd-icon name="plus" [size]="14"></svg><span>Add</span>
      </button>
    </div>
    @if (problem(); as message) {
      <p id="field-name-problem" class="dialog-error" role="alert">{{ message }}</p>
    }
  `,
})
export class FieldEditor {
  readonly value = input.required<readonly FieldDefinition[]>();
  readonly changed = output<FieldDefinition[]>();
  protected readonly adding = signal("");
  protected readonly types = FIELD_TYPES;
  protected readonly titleCase = titleCase;
  protected readonly problem = computed(() => fieldNameProblem(fieldName(this.adding()), this.value()));

  /** Only choice fields have options. */
  protected setType(index: number, type: FieldType) {
    this.replace(index, ({ name, options }) => (type === "choice" ? { name, type, options: options ?? [] } : { name, type }));
  }

  protected setOptions(index: number, text: string) {
    const options = [
      ...new Set(
        text
          .split(",")
          .map((option) => option.trim())
          .filter(Boolean),
      ),
    ];
    this.replace(index, (field) => ({ ...field, options }));
  }

  protected move(index: number, step: -1 | 1) {
    const next = [...this.value()];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    this.changed.emit(next);
  }

  protected without(index: number): FieldDefinition[] {
    return this.value().filter((_, i) => i !== index);
  }

  /** New fields hold text until their kind changes. A name that cannot be one stays, with the reason, to correct it. */
  protected add() {
    const name = fieldName(this.adding());
    if (!name || this.problem()) return;
    this.changed.emit([...this.value(), { name, type: "text" }]);
    this.adding.set("");
  }

  private replace(index: number, change: (field: FieldDefinition) => FieldDefinition) {
    this.changed.emit(this.value().map((field, i) => (i === index ? change(field) : field)));
  }
}
