import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { dismissTodo, openItems, parsePullBody, promoteTodo, resolveTodo, shortenTopic } from "../../../../utilities/pull-requests";
import { Dialogs } from "../../core/dialogs";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { DialogFrame } from "../../ui/dialog-frame";
import { PullActions } from "./pull-actions";

/**
 * Settles what a pull request leaves open, one item at a time: a to-do is
 * resolved, dismissed with a reason, or promoted to a new task and replaced
 * by a reference to it; a topic is shortened to its outcome. Verdicts stay.
 */
@Component({
  selector: "gd-cleanup-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="'Clean up ' + data.id" [width]="620" (submitted)="dialog.close()">
      @if (pull(); as current) {
        @if (items().todos.length) {
          <h3 class="cleanup-heading">Open to-dos</h3>
          <ul class="cleanup-list">
            @for (todo of items().todos; track todo.line) {
              <li class="cleanup-item">
                <span class="grow">{{ todo.text }}</span>
                <button type="button" class="btn btn-ghost btn-s" title="The change was made" (click)="resolve(todo.line)">Resolve</button>
                <button type="button" class="btn btn-ghost btn-s" title="Not acted on, with a reason" (click)="dismiss(todo.line)">
                  Dismiss…
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-s"
                  title="A new task, referenced here"
                  (click)="promote(todo.line, todo.text)"
                >
                  To task
                </button>
              </li>
            }
          </ul>
        }
        @if (items().topics.length) {
          <h3 class="cleanup-heading">Topics without an outcome</h3>
          <ul class="cleanup-list">
            @for (topic of items().topics; track topic.line) {
              <li class="cleanup-item">
                <span class="grow">{{ topic.title }}</span>
                <button
                  type="button"
                  class="btn btn-ghost btn-s"
                  title="Replace the discussion with what came of it"
                  (click)="shorten(topic.line, topic.title)"
                >
                  Shorten to outcome…
                </button>
              </li>
            }
          </ul>
        }
        @if (!items().todos.length && !items().topics.length) {
          <p>Nothing is left open.</p>
        }
        <p class="dialog-hint">
          The full discussion stays in Git.
          @if (inCheckout()) {
            In the checkout, a squash merge drops its history; keep pull requests on the content branch to keep it.
          }
        </p>
      } @else {
        <p>{{ data.id }} is no longer in the pull request folder.</p>
      }
      <footer>
        <button type="submit" class="btn btn-primary btn-m"><span>Done</span></button>
      </footer>
    </gd-dialog-frame>
  `,
  styles: `
    .cleanup-heading {
      margin: 4px 0 6px;
      font-size: 13px;
    }
    .cleanup-list {
      margin: 0 0 12px;
      padding: 0;
      list-style: none;
    }
    .cleanup-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 0;
      border-bottom: 1px solid var(--line);
    }
  `,
})
export class CleanupDialog {
  protected readonly data = inject<{ readonly id: string }>(DIALOG_DATA);
  protected readonly dialog = inject(DialogRef);
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly actions = inject(PullActions);
  /** The pull request as it is now: each step saves it. */
  protected readonly pull = computed(() => this.session.snapshot()?.pulls.find((pull) => pull.id === this.data.id) ?? null);
  protected readonly items = computed(() => openItems(parsePullBody(this.pull()?.body ?? "")));
  protected readonly inCheckout = computed(() => this.session.snapshot()?.storage.areas.pulls === "checkout");

  protected resolve(line: number) {
    void this.actions.editBody(this.pull()!, (body) => resolveTodo(body, line));
  }

  protected async dismiss(line: number) {
    const reason = await this.dialogs.prompt({ title: "Dismiss the to-do", label: "Why it isn't done", confirm: "Dismiss" });
    if (reason) await this.actions.editBody(this.pull()!, (body) => dismissTodo(body, line, reason));
  }

  protected async promote(line: number, text: string) {
    const pull = this.pull()!;
    const { settings } = this.session.snapshot()!;
    const task = await this.session.run(() =>
      this.api.content.createTask({
        title: text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, label?: string) => label ?? target).slice(0, 200),
        status: settings.statuses[0] ?? "backlog",
        priority: "medium",
        assignee: "",
        labels: [],
        epic: "",
        body: `From the review of ${pull.id}, *${pull.title}*.\n\n${text}\n`,
      }),
    );
    if (task) await this.actions.editBody(this.pull()!, (body) => promoteTodo(body, line, task.id), `Created ${task.id}`);
  }

  protected async shorten(line: number, title: string) {
    const outcome = await this.dialogs.prompt({
      title: `Shorten “${title}”`,
      label: "What came of it",
      hint: "Replaces the topic's remarks, code ranges and to-dos; verdicts stay.",
      confirm: "Shorten",
    });
    if (outcome) await this.actions.editBody(this.pull()!, (body) => shortenTopic(body, line, outcome));
  }
}
