import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import type { TaskActivity as Activity, Task, TaskChange, TaskField } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { Avatar } from "../../ui/avatar";
import { relativeTime } from "../history/commit-graph";
import { epicName, titleCase } from "./task-model";

const valueText = (field: TaskField, value: string): string =>
  field === "status" || field === "priority"
    ? titleCase(value)
    : field === "type"
      ? value
        ? titleCase(value)
        : "none"
      : field === "epic"
        ? epicName(value)
        : field === "assignee"
          ? value || "nobody"
          : `“${value}”`;

const counted = (count: number, verb: string) => (count === 1 ? `${verb} a comment` : `${verb} ${count} comments`);

/** One change in words: "status Todo → In progress". */
export function describeChange(change: TaskChange): string {
  switch (change.kind) {
    case "created":
      return "created the task";
    case "field":
      return `${change.field} ${valueText(change.field, change.from)} → ${valueText(change.field, change.to)}`;
    case "labels":
      return `labels ${[...change.added.map((label) => `+${label}`), ...change.removed.map((label) => `−${label}`)].join(" ")}`;
    case "description":
      return "edited the description";
    case "comments":
      return [
        change.added && counted(change.added, "added"),
        change.edited && counted(change.edited, "edited"),
        change.removed && counted(change.removed, "deleted"),
      ]
        .filter(Boolean)
        .join(", ");
    case "custom":
      return `${change.field} ${change.from || "none"} → ${change.to || "none"}`;
    case "other":
      return `changed ${change.fields.join(", ")}`;
  }
}

/**
 * Who changed a task and how, from the Git history of its file. Edits not
 * committed yet come first. Loads when shown, and again when the task or the
 * checked-out commit changes.
 */
@Component({
  selector: "gd-task-activity",
  imports: [Avatar],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-activity" },
  template: `
    @if (error(); as error) {
      <p class="task-activity-note">{{ error }}</p>
    } @else if (entries(); as entries) {
      @for (entry of entries; track entry.commit) {
        <article class="task-activity-entry">
          <header class="task-activity-header">
            <gd-avatar [name]="entry.author || '?'" [size]="20" />
            <span class="task-activity-author">{{ entry.author || "Unknown" }}</span>
            @if (entry.date) {
              <time class="faint" [attr.datetime]="entry.date" [title]="localTime(entry.date)">{{ relativeTime(entry.date) }}</time>
            } @else {
              <span class="task-activity-pending" title="Commit the task file to record this change">Not committed yet</span>
            }
          </header>
          <ul class="task-activity-changes">
            @for (change of entry.changes; track $index) {
              <li>{{ describeChange(change) }}</li>
            } @empty {
              <li>edited the file</li>
            }
          </ul>
          @if (entry.commit) {
            <button type="button" class="task-activity-commit" title="Show the commit" (click)="openCommit(entry.commit)">
              <span class="mono">{{ entry.commit.slice(0, 7) }}</span> {{ entry.subject }}
            </button>
          }
        </article>
      } @empty {
        <p class="task-activity-note">No changes recorded yet.</p>
      }
    } @else {
      <p class="task-activity-note">Loading…</p>
    }
  `,
})
export class TaskActivity {
  readonly task = input.required<Task>();

  private readonly api = inject(WorkspaceApi);
  private readonly session = inject(Session);
  private readonly router = inject(Router);
  protected readonly relativeTime = relativeTime;
  protected readonly describeChange = describeChange;
  protected readonly entries = signal<readonly Activity[] | null>(null);
  protected readonly error = signal<string | null>(null);
  /** The file, its version and the checked-out commit: a change to any can change the activity. */
  private readonly source = computed(() => `${this.task().path}\n${this.task().hash}\n${this.session.snapshot()?.head.commit}`);
  /** Loads count up, so a slow one never replaces a newer one. */
  private loads = 0;

  constructor() {
    effect(() => {
      this.source();
      untracked(() => void this.load(this.task().path));
    });
  }

  private async load(path: string) {
    const load = ++this.loads;
    try {
      const entries = await this.api.content.taskActivity(path);
      if (load !== this.loads) return;
      this.entries.set(entries);
      this.error.set(null);
    } catch (failure) {
      if (load === this.loads) this.error.set(messageOf(failure));
    }
  }

  protected localTime(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  protected openCommit(commit: string) {
    void this.router.navigate(["/history"], { queryParams: { commit } });
  }
}
