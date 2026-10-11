import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import type { Settings, Task } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { dueTone, formatDate, isDate, relativeDay, today, type DueTone } from "../../ui/calendar-date";

export interface DueDate {
  readonly field: string;
  readonly text: string;
  readonly tone: DueTone | null;
  readonly title: string;
}

/**
 * The task's date fields as dates in Markdown show: in the user's language,
 * overdue once passed and due soon when near, until the task reaches the
 * last workflow state.
 */
export function dueDatesOf(task: Task, settings: Pick<Settings, "fields" | "statuses">, on: string): DueDate[] {
  const done = task.status === settings.statuses.at(-1);
  return settings.fields
    .filter((field) => field.type === "date" && isDate(String(task.fields[field.name] ?? "")))
    .map((field) => {
      const iso = String(task.fields[field.name]);
      const tone = dueTone(iso, on, done);
      const when = relativeDay(iso, on);
      return {
        field: field.name,
        text: formatDate(iso),
        tone,
        title: `${field.name}: ${tone === "overdue" ? `${when}, overdue` : tone === "soon" ? `${when}, due soon` : when}`,
      };
    });
}

/** A task's date fields, as chips; see {@link dueDatesOf}. */
@Component({
  selector: "gd-due-dates",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "due-dates" },
  template: `
    @for (date of dates(); track date.field) {
      <span class="md-date" [class.is-overdue]="date.tone === 'overdue'" [class.is-soon]="date.tone === 'soon'" [title]="date.title">{{
        date.text
      }}</span>
    }
  `,
})
export class DueDates {
  readonly task = input.required<Task>();
  private readonly session = inject(Session);
  protected readonly dates = computed(() => dueDatesOf(this.task(), this.session.snapshot()!.settings, today()));
}
