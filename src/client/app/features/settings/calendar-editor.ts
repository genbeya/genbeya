import { ChangeDetectionStrategy, Component, computed, input, output, signal } from "@angular/core";
import { WEEKDAYS, type Milestone, type Settings, type Weekday } from "../../../../contracts/model";
import { Icon } from "../../ui/icon";

type Calendar = Pick<Settings, "workdays" | "holidays" | "milestones">;

const DAY_LABELS: Readonly<Record<Weekday, string>> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The working days, holidays and dated milestones that plans count with. */
@Component({
  selector: "gd-calendar-editor",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="calendar-days" role="group" aria-label="Working days">
      @for (day of days; track day) {
        <label class="checkbox">
          <input
            type="checkbox"
            [checked]="value().workdays.includes(day)"
            [disabled]="value().workdays.length === 1 && value().workdays.includes(day)"
            (change)="toggleDay(day)"
          />
          {{ labels[day] }}
        </label>
      }
    </div>
    <label class="field">
      Holidays
      <input
        #holidays
        class="input mono"
        placeholder="2026-12-25, 2026-12-26"
        [value]="value().holidays.join(', ')"
        (change)="setHolidays(holidays.value)"
      />
    </label>
    @if (holidayProblem(); as message) {
      <small class="calendar-problem" role="alert">{{ message }}</small>
    }
    <div class="calendar-milestones" role="list" aria-label="Milestones">
      @for (milestone of value().milestones; track $index) {
        <div class="calendar-milestone" role="listitem">
          <input
            #name
            class="input"
            aria-label="Milestone name"
            [value]="milestone.name"
            (change)="setMilestone($index, { name: name.value.trim(), due: milestone.due })"
          />
          <input
            #due
            class="input mono"
            type="date"
            aria-label="Milestone date"
            [value]="milestone.due"
            (change)="setMilestone($index, { name: milestone.name, due: due.value })"
          />
          <button type="button" class="icon-btn" aria-label="Remove milestone" title="Remove milestone" (click)="removeMilestone($index)">
            <svg gd-icon name="x" [size]="14"></svg>
          </button>
        </div>
      }
      <button type="button" class="btn btn-default btn-s" (click)="addMilestone()">
        <svg gd-icon name="plus" [size]="13"></svg><span>Add a milestone</span>
      </button>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .calendar-days {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 12px;
    }
    .calendar-milestones {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
    }
    .calendar-milestone {
      display: flex;
      gap: 6px;
      width: 100%;
    }
    .calendar-problem {
      color: var(--red);
    }
  `,
})
export class CalendarEditor {
  readonly value = input.required<Calendar>();
  readonly changed = output<Calendar>();
  protected readonly days = WEEKDAYS;
  protected readonly labels = DAY_LABELS;
  private readonly badHolidays = signal<string[]>([]);
  protected readonly holidayProblem = computed(() =>
    this.badHolidays().length ? `Not a date: ${this.badHolidays().join(", ")}. Write dates as 2026-12-25.` : null,
  );

  protected toggleDay(day: Weekday) {
    const { workdays } = this.value();
    const next = workdays.includes(day) ? workdays.filter((other) => other !== day) : [...workdays, day];
    this.changed.emit({ ...this.value(), workdays: WEEKDAYS.filter((other) => next.includes(other)) });
  }

  protected setHolidays(text: string) {
    const dates = text
      .split(/[\s,;]+/)
      .map((date) => date.trim())
      .filter(Boolean);
    const bad = dates.filter((date) => !DATE.test(date) || Number.isNaN(Date.parse(date)));
    this.badHolidays.set(bad);
    if (!bad.length) this.changed.emit({ ...this.value(), holidays: [...new Set(dates)].sort() });
  }

  protected setMilestone(index: number, milestone: Milestone) {
    this.changed.emit({ ...this.value(), milestones: this.value().milestones.map((other, i) => (i === index ? milestone : other)) });
  }

  protected removeMilestone(index: number) {
    this.changed.emit({ ...this.value(), milestones: this.value().milestones.filter((_, i) => i !== index) });
  }

  protected addMilestone() {
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const taken = new Set(this.value().milestones.map((milestone) => milestone.name));
    let number = this.value().milestones.length + 1;
    while (taken.has(`Milestone ${number}`)) number++;
    this.changed.emit({ ...this.value(), milestones: [...this.value().milestones, { name: `Milestone ${number}`, due }] });
  }
}
