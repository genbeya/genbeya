import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import type { PullRequest, Task } from "../../../../contracts/model";
import { approvalsOf, parsePullBody, verdictRevisions } from "../../../../utilities/pull-requests";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { Icon } from "../../ui/icon";
import { PullLinks } from "./pull-links";
import { STATUS_ICONS, STATUS_LABELS } from "./pull-status";

/** The pull requests of a task, with their state: "Open into develop, 1 of 2 approvals". */
@Component({
  selector: "gd-task-pulls",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-pulls", role: "group", "aria-label": "Pull requests of this task", "[hidden]": "!pulls().length" },
  template: `
    @for (pull of pulls(); track pull.id) {
      <button type="button" class="task-pull" (click)="open(pull.id)">
        <svg gd-icon class="is-{{ pull.status }}" [name]="icons[pull.status]" [size]="13"></svg>
        <span class="task-pull-title">{{ pull.id }} {{ pull.title }}</span>
        <span>· {{ stateOf(pull) }}</span>
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 4px;
      margin: 0 0 12px;
    }
    .task-pull {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--text-2);
      font-size: 12.5px;
      text-align: left;
    }
    .task-pull:hover .task-pull-title {
      text-decoration: underline;
    }
    .task-pull-title {
      color: var(--text);
    }
    .is-open {
      color: var(--green);
    }
    .is-merged {
      color: var(--purple);
    }
    .is-closed {
      color: var(--red);
    }
    .is-draft {
      color: var(--text-3);
    }
  `,
})
export class TaskPulls {
  readonly task = input.required<Task>();

  private readonly links = inject(PullLinks);
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly icons = STATUS_ICONS;
  protected readonly pulls = computed(() => this.links.of(this.task().id));
  /** Effective approvals of the open pull requests, by ID, once compared. */
  private readonly approved = signal<ReadonlyMap<string, number>>(new Map());

  constructor() {
    effect(() => {
      const pulls = this.pulls().filter((pull) => pull.status === "open" || pull.status === "draft");
      // Any branch may have moved.
      this.session.snapshot();
      untracked(() => void this.compare(pulls));
    });
  }

  private async compare(pulls: readonly PullRequest[]) {
    const folder = this.session.snapshot()?.settings.pullRoot ?? null;
    const counts = await Promise.all(
      pulls.map(async (pull): Promise<[string, number]> => {
        const replies = parsePullBody(pull.body).replies;
        try {
          const compared = await this.api.versionControl.compare(pull.source, pull.target, verdictRevisions(replies), folder);
          const changes = new Map(compared.revisions.map((revision) => [revision.revision, revision.change]));
          return [pull.id, approvalsOf(replies, pull.reviewers, changes, compared.change).effective];
        } catch {
          return [pull.id, -1];
        }
      }),
    );
    this.approved.set(new Map(counts));
  }

  protected stateOf(pull: PullRequest): string {
    const state = `${STATUS_LABELS[pull.status]} into ${pull.target}`;
    if (pull.status !== "open") return state;
    const required = this.session.snapshot()?.settings.requiredApprovals ?? 0;
    const approved = this.approved().get(pull.id);
    if (approved === undefined || approved < 0 || !required) return state;
    return `${state}, ${approved} of ${required} ${required === 1 ? "approval" : "approvals"}`;
  }

  protected open(id: string) {
    void this.router.navigate(["/pulls"], { queryParams: { pull: id } });
  }
}
