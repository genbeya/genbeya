/** The small graphics of tasks: status rings, type icons, priority bars, label chips. */
import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { Session } from "../../core/session";
import { Icon } from "../../ui/icon";
import { iconFor, knownIcon } from "../../ui/icons";
import { labelColor, statusColor, titleCase, toneColor, typeLook } from "./task-model";

/** The state's configured icon, or a ring that fills as the status advances; the final state is a check. */
@Component({
  selector: "gd-status-icon",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: inline-flex" },
  template: `
    @if (configured(); as configured) {
      <svg gd-icon [name]="configured" [size]="size()" [color]="color()" [strokeWidth]="2.2"></svg>
    } @else if (index() === statuses().length - 1) {
      <svg gd-icon name="circle-check" [size]="size()" [color]="color()" [strokeWidth]="2.2"></svg>
    } @else if (index() <= 0) {
      <svg gd-icon name="circle-dashed" [size]="size()" [color]="color()" [strokeWidth]="2.2"></svg>
    } @else {
      <svg [attr.width]="size()" [attr.height]="size()" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="6" fill="none" [attr.stroke]="color()" stroke-width="1.6" />
        <circle
          cx="7"
          cy="7"
          r="4"
          fill="none"
          [attr.stroke]="color()"
          stroke-width="8"
          [attr.stroke-dasharray]="dash()"
          transform="rotate(-90 7 7)"
        />
      </svg>
    }
  `,
})
export class StatusIcon {
  readonly status = input.required<string>();
  readonly statuses = input.required<readonly string[]>();
  /** The state's icon from the settings, if it has one. */
  readonly iconName = input<string>();
  readonly size = input(14);
  protected readonly configured = computed(() => knownIcon(this.iconName()));
  protected readonly index = computed(() => this.statuses().indexOf(this.status()));
  protected readonly color = computed(() => statusColor(this.index(), this.statuses().length));
  protected readonly dash = computed(() => {
    const circumference = 2 * Math.PI * 4;
    return `${(circumference * this.index()) / (this.statuses().length - 1)} ${circumference}`;
  });
}

/**
 * A task type's icon in its colour, named for screen readers unless the type
 * is written next to it; nothing for tasks without a type.
 */
@Component({
  selector: "gd-type-icon",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    style: "display: inline-flex",
    "[attr.role]": "named() ? 'img' : null",
    "[attr.aria-label]": "named() ? name() : null",
    "[attr.title]": "named() ? name() : null",
  },
  template: `
    @if (type()) {
      <svg gd-icon [name]="iconFor(look().icon)" [size]="size()" [color]="toneColor(look().tone)"></svg>
    }
  `,
})
export class TypeIcon {
  readonly type = input.required<string>();
  readonly size = input(14);
  /** The type's name is shown next to the icon. */
  readonly decorative = input(false);
  protected readonly named = computed(() => !!this.type() && !this.decorative());
  private readonly session = inject(Session);
  protected readonly look = computed(() => typeLook(this.type(), this.session.snapshot()?.settings.types ?? []));
  protected readonly name = computed(() => titleCase(this.type()));
  protected readonly iconFor = iconFor;
  protected readonly toneColor = toneColor;
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
