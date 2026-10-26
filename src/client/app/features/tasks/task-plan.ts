import { ChangeDetectionStrategy, Component, computed, inject, input, output } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { effortOf, formatEffort, formatVariance, timeLogOf } from "../../../../utilities/planning";
import { Session } from "../../core/session";
import { MarkdownView } from "../../markdown/markdown-view";
import { Icon } from "../../ui/icon";
import { WikiActions } from "../wiki/wiki-actions";
import { TaskPlanning } from "./task-planning";

/**
 * Where a task stands in the plan: its effort (estimate, logged, remaining,
 * forecast and variance), with **Log time**, and its dependencies: what it
 * waits for, what it blocks, and what is wrong with them. Effort shows once
 * the project configures an effort field, or the task has a time log.
 */
@Component({
  selector: "gd-task-plan",
  imports: [Icon, MarkdownView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-plan", "[hidden]": "!shown()" },
  template: `
    @if (planned()) {
      <div class="task-effort" role="group" aria-label="Effort">
        @for (item of effort(); track item.label) {
          <span class="task-effort-item" [title]="item.hint">
            <span class="task-effort-label">{{ item.label }}</span>
            <span class="task-effort-value" [class.is-over]="item.over" [class.is-under]="item.under">{{ item.value }}</span>
          </span>
        }
        <span class="grow"></span>
        <button type="button" class="btn btn-default btn-s" (click)="logTime.emit()">
          <svg gd-icon name="clock" [size]="13"></svg><span>Log time</span>
        </button>
      </div>
      @if (unreadable(); as count) {
        <p class="task-plan-problem">
          {{ count }} {{ count === 1 ? "line" : "lines" }} of the time log can't be read: write them as
          <code>- 2026-10-21 — Name — 2h — What for</code>.
        </p>
      }
    }
    @if (relations(); as text) {
      <gd-markdown
        class="task-relations"
        [source]="text"
        [path]="task().path"
        [links]="wiki.linkTargets()"
        (linkClicked)="wiki.followLink($event)"
      />
    }
    @for (problem of problems(); track problem) {
      <p class="task-plan-problem">This task {{ problem }}.</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin: 4px 0 12px;
    }
    .task-effort {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 14px;
    }
    .task-effort-item {
      display: inline-flex;
      align-items: baseline;
      gap: 5px;
    }
    .task-effort-label {
      color: var(--text-3);
      font-size: 12px;
    }
    .task-effort-value {
      font-variant-numeric: tabular-nums;
      font-weight: 500;
    }
    .task-effort-value.is-over {
      color: var(--orange);
    }
    .task-effort-value.is-under {
      color: var(--green);
    }
    .task-relations {
      font-size: 13px;
    }
    .task-plan-problem {
      margin: 0;
      color: var(--orange);
      font-size: 12.5px;
    }
  `,
})
export class TaskPlan {
  readonly task = input.required<Task>();
  readonly logTime = output();

  protected readonly wiki = inject(WikiActions);
  private readonly session = inject(Session);
  private readonly settings = computed(() => this.session.snapshot()!.settings);
  private readonly log = computed(() => timeLogOf(this.task().body));
  /** Effort is shown once the project has an effort field, or the task logs time. */
  protected readonly planned = computed(
    () =>
      this.settings().fields.some((field) => field.type === "effort") || this.log().entries.length > 0 || this.log().unreadable.length > 0,
  );
  protected readonly unreadable = computed(() => this.log().unreadable.length);
  protected readonly effort = computed(() => {
    const task = this.task();
    const effort = effortOf({ fields: task.fields, logged: this.log().total }, task.status === this.settings().statuses.at(-1));
    const hours = (value: number | null) => (value === null ? "—" : formatEffort(value));
    const item = (label: string, value: string, hint: string, variance = 0) => ({
      label,
      value,
      hint,
      over: variance > 0,
      under: variance < 0,
    });
    const entries = this.log().entries.length;
    return [
      item("Estimate", hours(effort.estimate), "The original budget"),
      item("Logged", formatEffort(effort.logged), `${entries} ${entries === 1 ? "entry" : "entries"} in the time log`),
      item("Remaining", hours(effort.remaining), "The effort still needed"),
      item("Forecast", hours(effort.forecast), "Logged + remaining"),
      item("Variance", effort.variance === null ? "—" : formatVariance(effort.variance), "Forecast − estimate", effort.variance ?? 0),
    ];
  });
  private readonly dependencies = inject(TaskPlanning).dependencies;
  private readonly id = computed(() => this.task().id.toUpperCase());
  /** What the task waits for and blocks, as references showing each task's state. */
  protected readonly relations = computed(() => {
    const references = (ids: readonly string[] | undefined) => (ids ?? []).map((id) => `[[${id}]]`).join(" ");
    const { waitsFor, blocks } = this.dependencies();
    const waits = references(waitsFor.get(this.id()));
    const blocked = references(blocks.get(this.id()));
    const state = this.dependencies().states.get(this.id());
    return [waits && `**${state === "blocked" ? "Blocked by" : "Waits for"}** ${waits}`, blocked && `**Blocks** ${blocked}`]
      .filter(Boolean)
      .join("\n\n");
  });
  protected readonly problems = computed(() => this.dependencies().problems.get(this.id()) ?? []);
  protected readonly shown = computed(() => this.planned() || !!this.relations() || this.problems().length > 0);
}
