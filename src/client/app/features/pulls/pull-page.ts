import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import type { LineRange, PullComparison, PullRequest } from "../../../../contracts/model";
import {
  addDiscussionReply,
  addLocation,
  addReplyAt,
  addTopic,
  approvalsOf,
  gatesOf,
  openItems,
  parsePullBody,
  taskIdsOf,
  verdictRevisions,
  type Verdict,
} from "../../../../utilities/pull-requests";
import { Dialogs } from "../../core/dialogs";
import { MOD_KEY, matchesHotkey } from "../../core/hotkeys";
import { messageOf, Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { TextareaCompletion } from "../../editor/textarea-completion";
import { MarkdownView } from "../../markdown/markdown-view";
import { toggleCheckboxAt } from "../../markdown/task-checkbox";
import { Avatar } from "../../ui/avatar";
import { Icon } from "../../ui/icon";
import { DiffPane, type DiffAction, type DiffActionHandler } from "../diff/diff-pane";
import { WikiActions } from "../wiki/wiki-actions";
import type { CommentRequest, CommentResult } from "./comment-dialog";
import { PullActions, pullInputOf } from "./pull-actions";
import { STATUS_ICONS, STATUS_LABELS } from "./pull-status";

export type PullTab = "conversation" | "files";

const COMMENT: readonly DiffAction[] = [{ id: "comment", label: "Comment on", icon: "message-square" }];

const short = (commit: string | null | undefined) => commit?.slice(0, 7) ?? "";

/** `L3`, or `L3-L5`. */
const linesText = ({ from, to }: LineRange) => (from === to ? `L${from}` : `L${from}-L${to}`);

/**
 * A pull request: what it is, what stands between it and its merge, the
 * file's review and discussion with a reply box, and its files with the
 * diff from where the branches meet to the source, to comment on lines.
 */
@Component({
  selector: "gd-pull-page",
  imports: [Avatar, DiffPane, Icon, MarkdownView, TextareaCompletion],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view pull-page" },
  template: `
    <header class="pull-head">
      <div class="pull-title-row">
        <span class="pull-status is-{{ pull().status }}"
          ><svg gd-icon [name]="statusIcons[pull().status]" [size]="13"></svg>{{ statusLabels[pull().status] }}</span
        >
        <h2 class="pull-title selectable">
          {{ pull().title }} <span class="faint">{{ pull().id }}</span>
        </h2>
        <span class="grow"></span>
        <button type="button" class="icon-btn" aria-label="Edit" title="Edit title, branches and reviewers" (click)="actions.edit(pull())">
          <svg gd-icon name="pencil" [size]="15"></svg>
        </button>
        @if (inCheckout()) {
          <button type="button" class="icon-btn" aria-label="Open the file" title="Open the file" (click)="openFile()">
            <svg gd-icon name="file-code-2" [size]="15"></svg>
          </button>
        }
      </div>
      <div class="pull-meta">
        <gd-avatar [name]="pull().author || '?'" [size]="18" />
        <span
          >{{ pull().author || "Someone" }} {{ pull().status === "merged" ? "merged" : "wants to merge" }}
          <code>{{ pull().source }}</code> into <code>{{ pull().target }}</code></span
        >
        @if (comparison(); as compared) {
          <span class="faint">· {{ compared.ahead }} {{ compared.ahead === 1 ? "commit" : "commits" }}, {{ compared.behind }} behind</span>
        }
        @if (pull().mergeCommit; as merged) {
          <span class="faint"
            >· merge commit <code>{{ merged.slice(0, 8) }}</code></span
          >
        }
      </div>
      @if (pull().reviewers.length || approvals().reviewers.length) {
        <div class="pull-reviewers" aria-label="Reviewers">
          @for (state of approvals().reviewers; track state.person) {
            <span class="pull-reviewer is-{{ verdictClass(state.reply.verdict, state.approval) }}" [title]="verdictTitle(state)">
              <gd-avatar [name]="state.person" [size]="16" />{{ state.person }}
              <svg gd-icon [name]="verdictIcon(state.reply.verdict)" [size]="12"></svg>
            </span>
          }
          @for (person of approvals().waitingFor; track person) {
            <span class="pull-reviewer is-waiting" title="Asked for a review, no verdict yet"
              ><gd-avatar [name]="person" [size]="16" />{{ person }}</span
            >
          }
        </div>
      }
      <div class="pull-tabs-row">
        <div class="segmented" role="tablist" aria-label="Pull request">
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tab() === 'conversation'"
            [class.is-active]="tab() === 'conversation'"
            (click)="go('conversation')"
          >
            Conversation
          </button>
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="tab() === 'files'"
            [class.is-active]="tab() === 'files'"
            (click)="go('files')"
          >
            Files <span class="faint">{{ comparison()?.files?.length ?? "" }}</span>
          </button>
        </div>
        <span class="grow"></span>
        @switch (pull().status) {
          @case ("draft") {
            <button type="button" class="btn btn-default btn-s" (click)="ready()">Ready for review</button>
            <button type="button" class="btn btn-ghost btn-s" (click)="actions.setStatus(pull(), 'closed', 'Closed ' + pull().id)">
              Close
            </button>
          }
          @case ("open") {
            @if (open().todos.length || open().topics.length) {
              <button type="button" class="btn btn-ghost btn-s" (click)="cleanUp()">Clean up…</button>
            }
            <button type="button" class="btn btn-ghost btn-s" (click)="actions.setStatus(pull(), 'closed', 'Closed ' + pull().id)">
              Close
            </button>
            @if (comparison()?.head && comparison()!.ahead === 0) {
              <button
                type="button"
                class="btn btn-default btn-s"
                title="The target has every commit of the source"
                (click)="actions.markMerged(pull().id)"
              >
                Mark merged
              </button>
            } @else {
              <button type="button" class="btn btn-primary btn-s" [disabled]="!comparison()?.head" (click)="actions.merge(pull())">
                <svg gd-icon name="git-merge" [size]="13"></svg><span>Merge</span>
              </button>
            }
          }
          @case ("closed") {
            <button type="button" class="btn btn-default btn-s" (click)="actions.setStatus(pull(), 'open', 'Reopened ' + pull().id)">
              Reopen
            </button>
          }
        }
      </div>
    </header>

    @if (tab() === "conversation") {
      <div class="content-scroll">
        <div class="pull-conversation">
          @if (compareError(); as message) {
            <p class="pull-problem selectable">Can't compare the branches: {{ message }}</p>
          } @else if (comparison() && !comparison()!.head) {
            <p class="pull-problem">The branch {{ pull().source }} doesn't exist here. Fetch it, or edit the pull request.</p>
          }
          @if (parsed().unreadable.length) {
            <div class="pull-problem">
              Genbeya can't read {{ parsed().unreadable.length === 1 ? "this line" : "these lines" }}; write replies as
              <code>**Name — 2026-10-23 12:41+02:00:** text</code>:
              <ul>
                @for (line of parsed().unreadable; track $index) {
                  <li>
                    <code>{{ line }}</code>
                  </li>
                }
              </ul>
            </div>
          }
          @if (pull().status === "open" || pull().status === "draft") {
            <ul class="pull-gates" aria-label="Ready to merge?">
              @for (gate of gates(); track gate.key) {
                <li class="pull-gate is-{{ gate.state }}">
                  <svg
                    gd-icon
                    [name]="gate.state === 'passed' ? 'circle-check' : gate.state === 'failed' ? 'circle-x' : 'circle-question-mark'"
                    [size]="14"
                  ></svg>
                  {{ gate.text }}
                </li>
              }
            </ul>
          }
          @if (tasks()) {
            <gd-markdown
              class="pull-tasks"
              [source]="tasks()!"
              [path]="pull().path"
              [links]="wiki.linkTargets()"
              (linkClicked)="wiki.followLink($event)"
            />
          }
          <gd-markdown
            class="pull-body"
            [source]="pull().body || '*No description.*'"
            [path]="pull().path"
            [links]="wiki.linkTargets()"
            [checkboxes]="true"
            (linkClicked)="wiki.followLink($event)"
            (checkboxToggled)="toggleCheckbox($event)"
          />
          <div class="pull-composer">
            <label class="field">
              Reply to
              <select #targetField class="select" (change)="replyTo.set(+targetField.value)">
                <option value="-1" [selected]="replyTo() === -1">The discussion</option>
                @for (place of places(); track place.line) {
                  <option [value]="place.line" [selected]="replyTo() === place.line">{{ place.label }}</option>
                }
              </select>
            </label>
            <textarea
              #composer
              class="textarea"
              aria-label="Reply"
              placeholder="Reply… Markdown and [[references]] work."
              [gdTextCompletion]="wiki.people()"
              [value]="draft()"
              (input)="draft.set(composer.value)"
              (keydown)="composeKey($event)"
            ></textarea>
            <div class="pull-composer-actions">
              @if (mine() && pull().status !== "merged") {
                <button
                  type="button"
                  class="btn btn-ghost btn-s"
                  [disabled]="sending()"
                  (click)="verdict({ kind: 'requested review', revision: null })"
                >
                  Request review
                </button>
              }
              <span class="grow"></span>
              @if (myApproval()) {
                <button
                  type="button"
                  class="btn btn-ghost btn-s"
                  [disabled]="sending()"
                  (click)="verdict({ kind: 'withdrew approval', revision: null })"
                >
                  Withdraw approval
                </button>
              }
              <button
                type="button"
                class="btn btn-default btn-s"
                [disabled]="sending() || !comparison()?.head"
                [title]="'Request changes at ' + short(comparison()?.head)"
                (click)="verdict({ kind: 'requested changes', revision: comparison()!.head })"
              >
                Request changes
              </button>
              <button
                type="button"
                class="btn btn-default btn-s"
                [disabled]="sending() || !comparison()?.head"
                [title]="'Approve ' + short(comparison()?.head)"
                (click)="verdict({ kind: 'approved', revision: comparison()!.head })"
              >
                <svg gd-icon name="thumbs-up" [size]="13"></svg><span>Approve</span>
              </button>
              <button type="button" class="btn btn-primary btn-s" [disabled]="!draft().trim() || sending()" (click)="send()">
                <span>Reply</span><kbd class="kbd">{{ mod }} ↵</kbd>
              </button>
            </div>
          </div>
        </div>
      </div>
    } @else {
      <div class="view-body pull-files">
        <aside class="side-panel pull-file-list" role="list" aria-label="Changed files">
          @for (changed of comparison()?.files ?? []; track changed.path) {
            <button
              type="button"
              role="listitem"
              class="pull-file"
              [class.is-selected]="changed.path === file()"
              [title]="changed.oldPath ? changed.oldPath + ' → ' + changed.path : changed.path"
              (click)="selectFile(changed.path)"
            >
              <span class="status-letter {{ changed.status }}">{{ changed.status }}</span
              ><span class="ellipsis grow">{{ changed.path }}</span>
              @if (threadCount(changed.path); as count) {
                <span class="pull-file-threads" [attr.aria-label]="count + ' threads'"
                  ><svg gd-icon name="message-square" [size]="11"></svg>{{ count }}</span
                >
              }
            </button>
          } @empty {
            <p class="faint pull-files-empty">{{ comparison() ? "No changes between the branches." : "Comparing…" }}</p>
          }
        </aside>
        <section class="main-pane pull-diff">
          @if (threads().length) {
            <div class="pull-threads">
              @for (thread of threads(); track thread.line) {
                <article class="pull-thread">
                  <header>
                    <strong>{{ thread.topic }}</strong>
                    <span class="faint">{{ thread.lines }}</span>
                    @if (thread.outdated) {
                      <span
                        class="pull-outdated"
                        [title]="'Written at ' + short(thread.revision) + '; the source is at ' + short(comparison()?.head)"
                        >outdated</span
                      >
                    }
                    <span class="grow"></span>
                    <button type="button" class="btn btn-ghost btn-s" (click)="replyIn(thread.line)">Reply</button>
                  </header>
                  <gd-markdown
                    [source]="thread.text"
                    [path]="pull().path"
                    [links]="wiki.linkTargets()"
                    (linkClicked)="wiki.followLink($event)"
                  />
                </article>
              }
            </div>
          }
          @if (selected(); as changed) {
            @for (key of [changed.path + comparison()!.head]; track key) {
              <gd-diff-pane
                [path]="changed.path"
                [load]="loadDiff()"
                [loadImages]="loadImages()"
                [actions]="comment"
                [staging]="false"
                [apply]="commentOn"
                [badge]="short(comparison()!.base) + '…' + short(comparison()!.head)"
              />
            }
          }
        </section>
      </div>
    }
  `,
})
export class PullPage {
  readonly pull = input.required<PullRequest>();
  readonly tab = input<PullTab>("conversation");
  readonly file = input<string>();

  protected readonly actions = inject(PullActions);
  protected readonly wiki = inject(WikiActions);
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);
  protected readonly mod = MOD_KEY;
  protected readonly short = short;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly statusIcons = STATUS_ICONS;
  protected readonly comment = COMMENT;

  protected readonly parsed = computed(() => parsePullBody(this.pull().body));
  protected readonly open = computed(() => openItems(this.parsed()));
  protected readonly comparison = signal<PullComparison | null>(null);
  protected readonly compareError = signal<string | null>(null);
  private readonly snapshot = computed(() => this.session.snapshot()!);
  protected readonly inCheckout = computed(() => this.snapshot().storage.areas.pulls === "checkout");
  protected readonly approvals = computed(() => {
    const compared = this.comparison();
    const changes = new Map((compared?.revisions ?? []).map((revision) => [revision.revision, revision.change]));
    return approvalsOf(this.parsed().replies, this.pull().reviewers, changes, compared?.change ?? null);
  });
  protected readonly gates = computed(() => {
    const { head, changes, settings } = this.snapshot();
    const pull = this.pull();
    const here = head.branch === pull.source || head.branch === pull.target;
    return gatesOf({
      approvals: this.approvals(),
      required: settings.requiredApprovals,
      openTodos: this.open().todos.length,
      conflicts: this.comparison()?.conflicts ?? null,
      uncommitted: here ? changes.length : null,
      target: pull.target,
    });
  });
  /** The tasks the pull request names, as references showing their state. */
  protected readonly tasks = computed(() => {
    const { tasks, settings } = this.snapshot();
    const known = new Set(tasks.map((task) => task.id.toUpperCase()));
    const ids = taskIdsOf(this.pull(), settings.taskPrefix).filter((id) => known.has(id));
    return ids.length ? `**Tasks** ${ids.map((id) => `[[${id}]]`).join(" ")}` : null;
  });
  /** Where a reply can go: the topics and their code ranges, by the line they start on. */
  protected readonly places = computed(() =>
    this.parsed().topics.flatMap((topic) => [
      { line: topic.line, label: topic.title },
      ...topic.locations.map((location) => ({ line: location.line, label: `${topic.title} — ${location.reference.split("@")[0]}` })),
    ]),
  );
  protected readonly replyTo = signal(-1);
  protected readonly draft = signal("");
  protected readonly sending = signal(false);
  private readonly me = signal<string | null>(null);
  protected readonly mine = computed(() => !!this.me() && this.me()!.toLowerCase() === this.pull().author.toLowerCase());
  protected readonly myApproval = computed(() =>
    this.approvals().reviewers.some(
      (state) => state.person.toLowerCase() === this.me()?.toLowerCase() && state.reply.verdict?.kind === "approved",
    ),
  );

  protected readonly selected = computed(() => this.comparison()?.files.find((changed) => changed.path === this.file()));
  protected readonly loadDiff = computed(() => {
    const [changed, compared] = [this.selected(), this.comparison()];
    return () => this.api.versionControl.diff(changed!.path, { from: compared!.base!, to: compared!.head! }, changed?.oldPath);
  });
  protected readonly loadImages = computed(() => {
    const [changed, compared] = [this.selected(), this.comparison()];
    return () => this.api.versionControl.diffImages(changed!.path, { from: compared!.base!, to: compared!.head! }, changed?.oldPath);
  });
  /** The review's code ranges in the selected file, with their text in the file. */
  protected readonly threads = computed(() => {
    const lines = this.pull().body.split("\n");
    const head = this.comparison()?.head;
    return this.parsed().topics.flatMap((topic) =>
      topic.locations
        .filter((location) => location.path === this.file())
        .map((location) => ({
          line: location.line,
          topic: topic.title,
          lines: location.lines ? linesText(location.lines) : "the whole file",
          revision: location.revision,
          outdated: !!head && !!location.revision && !head.startsWith(location.revision),
          text: lines
            .slice(location.line + 1, location.end)
            .join("\n")
            .trim(),
        })),
    );
  });
  private readonly threadCounts = computed(() => {
    const counts = new Map<string, number>();
    for (const topic of this.parsed().topics)
      for (const location of topic.locations) counts.set(location.path, (counts.get(location.path) ?? 0) + 1);
    return counts;
  });
  protected readonly threadCount = (path: string) => this.threadCounts().get(path) ?? 0;

  /** What the comparison depends on: the branches, the revisions verdicts name, and any move of a branch. */
  private readonly compareKey = computed(() => {
    const pull = this.pull();
    const { branches, remoteBranches, head } = this.snapshot();
    return JSON.stringify([pull.source, pull.target, verdictRevisions(this.parsed().replies), branches, remoteBranches, head.commit]);
  });
  private ticket = 0;

  constructor() {
    effect(() => {
      this.compareKey();
      untracked(() => void this.compare());
    });
    void this.actions.author().then(
      (name) => this.me.set(name),
      () => undefined,
    );
    // Without a file, show the first one.
    effect(() => {
      const first = this.comparison()?.files[0];
      if (this.tab() === "files" && first && !this.selected()) untracked(() => this.selectFile(first.path));
    });
  }

  private async compare() {
    const ticket = ++this.ticket;
    const pull = this.pull();
    try {
      const compared = await this.api.versionControl.compare(
        pull.source,
        pull.target,
        verdictRevisions(this.parsed().replies),
        this.snapshot().settings.pullRoot,
      );
      if (ticket !== this.ticket) return;
      this.comparison.set(compared);
      this.compareError.set(null);
    } catch (failure) {
      if (ticket === this.ticket) this.compareError.set(messageOf(failure));
    }
  }

  protected go(tab: PullTab) {
    void this.router.navigate(["/pulls"], {
      queryParams: { pull: this.pull().id, tab: tab === "conversation" ? null : tab },
      replaceUrl: true,
    });
  }

  protected selectFile(file: string) {
    void this.router.navigate(["/pulls"], { queryParams: { pull: this.pull().id, tab: "files", file }, replaceUrl: true });
  }

  protected openFile() {
    void this.router.navigate(["/code"], { queryParams: { file: this.pull().path } });
  }

  protected replyIn(line: number) {
    this.replyTo.set(line);
    this.go("conversation");
  }

  protected toggleCheckbox(offset: number) {
    void this.actions.editBody(this.pull(), (body) => toggleCheckboxAt(body, offset));
  }

  protected composeKey(event: KeyboardEvent) {
    // Taken by the suggestions.
    if (event.defaultPrevented) return;
    if (matchesHotkey("mod+enter", event)) {
      event.preventDefault();
      void this.send();
    }
  }

  /** Appends the reply where it was asked for. */
  protected async send() {
    const text = this.draft().trim();
    if (!text || this.sending()) return;
    await this.write(async (body) => {
      const reply = await this.actions.reply(text);
      return this.replyTo() < 0 ? addDiscussionReply(body, reply) : addReplyAt(body, this.replyTo(), reply);
    });
  }

  /** Appends a verdict, with the reply typed so far, to the discussion. */
  protected async verdict(verdict: Verdict) {
    if (this.sending()) return;
    await this.write(async (body) => addDiscussionReply(body, await this.actions.reply(this.draft().trim(), verdict)));
  }

  private async write(edit: (body: string) => Promise<string>) {
    this.sending.set(true);
    try {
      const body = await edit(this.pull().body);
      const saved = await this.actions.editBody(this.pull(), () => body);
      if (saved) {
        this.draft.set("");
        this.replyTo.set(-1);
      }
    } catch (failure) {
      this.notifications.error(failure);
    } finally {
      this.sending.set(false);
    }
  }

  /** Readies a draft and asks its reviewers for a review. */
  protected async ready() {
    const pull = this.pull();
    const reply = await this.actions.reply(this.draft().trim(), { kind: "requested review", revision: null });
    const input = { ...pullInputOf(pull), status: "open" as const, body: addDiscussionReply(pull.body, reply) };
    const saved = await this.actions.save(pull, input, `${pull.id} is ready for review`);
    if (saved) this.draft.set("");
  }

  protected async cleanUp() {
    const { CleanupDialog } = await import("./cleanup-dialog");
    await this.dialogs.open(CleanupDialog, { id: this.pull().id });
  }

  /** Starts a topic, or adds a code range to one, about the lines chosen in the diff. */
  protected readonly commentOn: DiffActionHandler = async (_action, lines) => {
    const compared = this.comparison();
    const path = this.file();
    if (!compared?.head || !compared.base || !path) return "cancelled";
    const span = (ranges: readonly LineRange[]): LineRange | null =>
      ranges.length ? { from: ranges[0]!.from, to: ranges.at(-1)!.to } : null;
    // Lines of the source; only removed ones are lines of the base.
    const added = span(lines.modified);
    const range = added ?? span(lines.original);
    const revision = added ? compared.head : compared.base;
    if (!range) return "cancelled";
    const file = await this.session.run(() => this.api.versionControl.fileAt(revision, path));
    if (!file) return "failed";
    const text = (file.content ?? "")
      .split("\n")
      .slice(range.from - 1, range.to)
      .join("\n");
    const { CommentDialog } = await import("./comment-dialog");
    const request: CommentRequest = {
      where: `${path}#${linesText(range)}`,
      text,
      topics: this.parsed().topics.map((topic) => ({ line: topic.line, title: topic.title })),
    };
    const result = await this.dialogs.open<CommentResult, CommentRequest>(CommentDialog, request);
    if (!result) return "cancelled";
    const reply = result.comment ? await this.actions.reply(result.comment) : null;
    const location = { reference: `${path}#${linesText(range)}@${revision}`, suggestion: result.suggestion, reply, todo: result.todo };
    const saved = await this.actions.editBody(this.pull(), (body) =>
      result.topic === null ? addTopic(body, result.title, location) : addLocation(body, result.topic, location),
    );
    return saved ? "done" : "failed";
  };

  protected verdictClass(verdict: Verdict | null, approval: string | null): string {
    if (verdict?.kind === "requested changes") return "changes";
    if (verdict?.kind === "approved") return approval === "effective" ? "approved" : "stale";
    return "withdrawn";
  }

  protected verdictIcon(verdict: Verdict | null) {
    return verdict?.kind === "approved" ? "circle-check" : verdict?.kind === "requested changes" ? "circle-x" : "circle-dashed";
  }

  protected verdictTitle(state: {
    readonly reply: { readonly verdict: Verdict | null; readonly date: string };
    readonly approval: string | null;
  }) {
    const { verdict, date } = state.reply;
    const at = verdict?.revision ? ` at ${short(verdict.revision)}` : "";
    const how =
      verdict?.kind === "approved"
        ? state.approval === "effective"
          ? "Approved the change to merge"
          : state.approval === "stale"
            ? "Approved, but the code changed since"
            : "Approved a revision this repository doesn't have"
        : verdict?.kind === "requested changes"
          ? "Requested changes"
          : "Withdrew the approval";
    return `${how}${at}, ${date}. Recorded in the file, not verified.`;
  }
}
