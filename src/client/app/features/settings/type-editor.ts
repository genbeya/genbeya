import { ChangeDetectionStrategy, Component, input, output, signal } from "@angular/core";
import { LucideArrowDown, LucideArrowUp, LucideFilePen, LucidePlus, LucideX } from "@lucide/angular";
import { taskType, TONES, type TaskType, type Tone } from "../../../../contracts/model";
import { IconPicker } from "../../ui/icon-picker";
import { titleCase, toneColor } from "../tasks/task-model";

/** The task types, in menu order: icon, colour and template of each; reorder, remove, add. */
@Component({
  selector: "gd-type-editor",
  imports: [IconPicker, LucideArrowDown, LucideArrowUp, LucideFilePen, LucidePlus, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "list-editor" },
  template: `
    @for (type of value(); track type.name; let index = $index; let first = $first; let last = $last) {
      <div class="list-item">
        <gd-icon-picker
          [value]="type.icon"
          [label]="'Icon of ' + titleCase(type.name)"
          [color]="toneColor(type.tone)"
          (changed)="update(index, { icon: $event! })"
        />
        <span class="grow">{{ titleCase(type.name) }}</span>
        <select
          class="select compact"
          [attr.aria-label]="'Colour of ' + titleCase(type.name)"
          (change)="setTone(index, $any($event.target).value)"
        >
          <option value="" [selected]="!type.tone">No colour</option>
          @for (tone of tones; track tone) {
            <option [value]="tone" [selected]="tone === type.tone">{{ titleCase(tone) }}</option>
          }
        </select>
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="'Edit the ' + type.name + ' template'"
          [title]="'Edit the template for new ' + type.name + ' tasks'"
          (click)="editTemplate.emit(type.name)"
        >
          <svg lucideFilePen [size]="13" aria-hidden="true"></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="Move up" title="Move up" [disabled]="first" (click)="move(index, -1)">
          <svg lucideArrowUp [size]="13" aria-hidden="true"></svg>
        </button>
        <button type="button" class="icon-btn" aria-label="Move down" title="Move down" [disabled]="last" (click)="move(index, 1)">
          <svg lucideArrowDown [size]="13" aria-hidden="true"></svg>
        </button>
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="'Remove ' + type.name"
          [title]="'Remove ' + type.name"
          (click)="changed.emit(without(index))"
        >
          <svg lucideX [size]="13" aria-hidden="true"></svg>
        </button>
      </div>
    }
    <div class="row list-add">
      <input
        #field
        class="input"
        placeholder="Add a type"
        aria-label="New task type"
        [value]="adding()"
        (input)="adding.set(field.value)"
        (keydown.enter)="$event.preventDefault(); add()"
      />
      <button type="button" class="btn btn-default btn-m" [disabled]="!adding().trim()" (click)="add()">
        <svg lucidePlus [size]="14" aria-hidden="true"></svg><span>Add</span>
      </button>
    </div>
  `,
})
export class TypeEditor {
  readonly value = input.required<readonly TaskType[]>();
  readonly changed = output<TaskType[]>();
  /** Asks to open the template of the named type. */
  readonly editTemplate = output<string>();
  protected readonly adding = signal("");
  protected readonly tones = TONES;
  protected readonly titleCase = titleCase;
  protected readonly toneColor = toneColor;

  protected update(index: number, change: Partial<TaskType>) {
    this.changed.emit(this.value().map((type, i) => (i === index ? { ...type, ...change } : type)));
  }

  protected setTone(index: number, tone: string) {
    const { name, icon } = this.value()[index]!;
    this.changed.emit(this.value().map((type, i) => (i === index ? { name, icon, ...(tone && { tone: tone as Tone }) } : type)));
  }

  protected move(index: number, step: -1 | 1) {
    const next = [...this.value()];
    [next[index], next[index + step]] = [next[index + step]!, next[index]!];
    this.changed.emit(next);
  }

  protected without(index: number): TaskType[] {
    return this.value().filter((_, i) => i !== index);
  }

  /** Types are stored lower-case with dashes, like states; well-known names bring their icon. */
  protected add() {
    const name = this.adding().trim().toLowerCase().replace(/\s+/g, "-");
    if (name && !this.value().some((type) => type.name.toLowerCase() === name)) this.changed.emit([...this.value(), taskType(name)]);
    this.adding.set("");
  }
}
