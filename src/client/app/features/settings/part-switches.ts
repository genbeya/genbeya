import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { PART_NEEDS, PARTS, shownParts, type Part } from "../../../../contracts/model";

/** The parts of the app as Settings names them. */
export const PART_LABELS: Readonly<Record<Part, string>> = {
  wiki: "Wiki",
  tasks: "Tasks",
  planning: "Planning",
  timelog: "Time log",
  code: "Code",
  changes: "Changes",
  history: "History",
  pulls: "Pull requests",
  terminal: "Terminal",
};

/** A switch per part, on unless `off` lists it; a part whose need is off can't be switched on alone. */
@Component({
  selector: "gd-part-switches",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: "group" },
  template: `
    @for (row of rows(); track row.part) {
      <label class="checkbox part-switch" [class.is-needing]="!!row.need">
        <input type="checkbox" [checked]="row.on" [disabled]="row.blocked" (change)="toggled.emit({ part: row.part, on: !row.on })" />
        {{ row.label }}
        @if (row.blocked) {
          <small class="faint">needs {{ row.blocked }}</small>
        } @else if (row.automatic) {
          <small class="faint" title="Shows once the project uses it, until you choose">automatic</small>
        }
      </label>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 6px 14px;
    }
    .part-switch small {
      font-size: 11.5px;
    }
  `,
})
export class PartSwitches {
  /** The parts switched off here. */
  readonly off = input.required<readonly Part[]>();
  /** Parts left out of the list, such as those the project doesn't use. */
  readonly omit = input<readonly Part[]>([]);
  /** Parts that follow the project's use of them until switched. */
  readonly automatic = input<readonly Part[]>([]);
  readonly toggled = output<{ readonly part: Part; readonly on: boolean }>();

  protected readonly rows = computed(() => {
    const shown = shownParts(this.off());
    return PARTS.filter((part) => !this.omit().includes(part)).map((part) => {
      const need = PART_NEEDS[part];
      return {
        part,
        label: PART_LABELS[part],
        need,
        on: shown.has(part),
        automatic: this.automatic().includes(part),
        // Switched off with what it needs: on again with that.
        blocked: need && !shown.has(need) ? PART_LABELS[need] : null,
      };
    });
  });
}
