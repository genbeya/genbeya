import { computed, inject, Injectable } from "@angular/core";
import {
  DEFAULT_CALENDAR,
  dependenciesOf,
  durationOf,
  planTasks,
  scheduleOf,
  type PlanCalendar,
  type ScheduledTask,
} from "../../../../utilities/planning";
import { Session } from "../../core/session";

/** The open repository's tasks as planning sees them, their dependencies and the schedule, worked out once per snapshot. */
@Injectable({ providedIn: "root" })
export class TaskPlanning {
  private readonly session = inject(Session);
  readonly statuses = computed(() => this.session.snapshot()?.settings.statuses ?? []);
  /** The project's working days, days off and milestones. */
  readonly calendar = computed((): PlanCalendar => {
    const settings = this.session.snapshot()?.settings;
    return settings ? { workdays: settings.workdays, holidays: settings.holidays, milestones: settings.milestones } : DEFAULT_CALENDAR;
  });
  readonly tasks = computed(() => planTasks(this.session.snapshot()?.tasks ?? []));
  readonly dependencies = computed(() => dependenciesOf(this.tasks(), this.statuses()));
  /** The critical path over all unfinished tasks. */
  readonly schedule = computed(() => scheduleOf(this.tasks(), this.dependencies(), this.statuses()));
  /**
   * Where each task stands on the critical path, by upper-case ID: unfinished
   * tasks that wait for or block another, or have a duration. Others are
   * left out, since a lone task is trivially critical.
   */
  readonly scheduled = computed(() => {
    const { waitsFor, blocks } = this.dependencies();
    const planned = new Map(this.tasks().map((task) => [task.id.toUpperCase(), task]));
    const found = new Map<string, ScheduledTask>();
    for (const task of this.schedule().tasks) {
      const id = task.id.toUpperCase();
      const plan = planned.get(id);
      if (waitsFor.has(id) || blocks.has(id) || (plan && durationOf(plan) !== null)) found.set(id, task);
    }
    return found;
  });
}
