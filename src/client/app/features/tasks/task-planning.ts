import { computed, inject, Injectable } from "@angular/core";
import { dependenciesOf, planTasks } from "../../../../utilities/planning";
import { Session } from "../../core/session";

/** The open repository's tasks as planning sees them, and their dependencies, worked out once per snapshot. */
@Injectable({ providedIn: "root" })
export class TaskPlanning {
  private readonly session = inject(Session);
  readonly statuses = computed(() => this.session.snapshot()?.settings.statuses ?? []);
  readonly tasks = computed(() => planTasks(this.session.snapshot()?.tasks ?? []));
  readonly dependencies = computed(() => dependenciesOf(this.tasks(), this.statuses()));
}
