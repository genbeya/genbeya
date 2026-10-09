/** The small graphics of tasks: status rings, priority bars, label chips. */
import { ChangeDetectionStrategy, Component, computed, input } from "@angular/core";
import { LucideCircleCheck, LucideCircleDashed } from "@lucide/angular";
import { labelColor, statusColor } from "./task-model";

/** A ring that fills as the status advances; the final state is a check. */
@Component({
  selector: "gd-status-icon",
  imports: [LucideCircleCheck, LucideCircleDashed],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: inline-flex" },
  template: `
    @if (index() === statuses().length - 1) {
      <svg lucideCircleCheck [size]="size()" [color]="color()" [strokeWidth]="2.2" aria-hidden="true"></svg>
    } @else if (index() <= 0) {
      <svg lucideCircleDashed [size]="size()" [color]="color()" [strokeWidth]="2.2" aria-hidden="true"></svg>
    } @else {
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" [attr.stroke]="color()" stroke-width="1.6" />
        <circle cx="7" cy="7" r="4" fill="none" [attr.stroke]="color()" stroke-width="8" [attr.stroke-dasharray]="dash()" transform="rotate(-90 7 7)" />
      </svg>
    }
  `,
})
export class StatusIcon {
  readonly status = input.required<string>();
  readonly statuses = input.required<readonly string[]>();
  readonly size = input(14);
  protected readonly index = computed(() => this.statuses().indexOf(this.status()));
  protected readonly color = computed(() => statusColor(this.index(), this.statuses().length));
  protected readonly dash = computed(() => {
    const circumference = 2 * Math.PI * 4;
    return `${(circumference * this.index()) / (this.statuses().length - 1)} ${circumference}`;
  });
}

const LEVELS: Readonly<Record<string, number>> = { high: 3, medium: 2, low: 1 };

/** Urgent is an alert square; other priorities are one to three bars. */
@Component({
  selector: "gd-priority-icon",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: inline-flex" },
  template: `
    <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 14 14" aria-hidden="true">
      @if (priority() === "urgent") {
        <rect x="1" y="1" width="12" height="12" rx="3" fill="var(--orange)" />
        <path d="M7 3.8v4.2" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
        <circle cx="7" cy="10.4" r="1" fill="#fff" />
      } @else {
        @for (bar of bars; track bar) {
          <rect
            [attr.x]="1.5 + bar * 4"
            [attr.y]="level() ? 9 - bar * 3 : 6"
            width="3"
            [attr.height]="level() ? 3.5 + bar * 3 : 2"
            rx="1"
            [attr.fill]="bar < level() ? 'var(--text-2)' : 'var(--line-strong)'"
          />
        }
      }
    </svg>
  `,
})
export class PriorityIcon {
  readonly priority = input.required<string>();
  readonly size = input(14);
  protected readonly bars = [0, 1, 2];
  protected readonly level = computed(() => LEVELS[this.priority()] ?? 0);
}

@Component({
  selector: "gd-label-chip",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "label-chip" },
  template: `<i [style.background]="color()"></i>{{ name() }}`,
})
export class LabelChip {
  readonly name = input.required<string>();
  protected readonly color = computed(() => labelColor(this.name()));
}
