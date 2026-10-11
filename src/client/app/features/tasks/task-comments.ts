import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from "@angular/core";
import type { Task } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { MOD_KEY, matchesHotkey } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { MarkdownView } from "../../markdown/markdown-view";
import { Avatar } from "../../ui/avatar";
import { Icon } from "../../ui/icon";
import { relativeTime } from "../../ui/relative-time";
import { WikiActions } from "../wiki/wiki-actions";

interface CommentVersion {
  readonly index: number;
  readonly path: string;
  readonly hash: string;
  readonly body: string;
}

/**
 * The comments at the end of a task's file, and a composer for new ones.
 * The user's own comments (signed with their Git name) can be edited and deleted.
 */
@Component({
  selector: "gd-task-comments",
  imports: [Avatar, Icon, MarkdownView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-comments" },
  template: `
    @for (comment of task().comments; track $index) {
      <article class="task-comment" [attr.aria-label]="'Comment by ' + comment.author">
        <header class="task-comment-header">
          <gd-avatar [name]="comment.author" [size]="20" />
          <span class="task-comment-author">{{ comment.author }}</span>
          <time class="faint" [attr.datetime]="comment.date" [title]="localTime(comment.date)">{{ relativeTime(comment.date) }}</time>
          <span class="grow"></span>
          @if (comment.author === author() && !editing()) {
            <button type="button" class="icon-btn" aria-label="Edit comment" title="Edit comment" (click)="startEditing($index)">
              <svg gd-icon name="pencil" [size]="13"></svg>
            </button>
            <button type="button" class="icon-btn" aria-label="Delete comment" title="Delete comment" (click)="remove($index)">
              <svg gd-icon name="trash-2" [size]="13"></svg>
            </button>
          }
        </header>
        @if (editing()?.index === $index) {
          <textarea
            #field
            class="textarea"
            aria-label="Edit comment"
            [value]="edited()"
            (input)="edited.set(field.value)"
            (keydown)="editKey($event)"
          ></textarea>
          <div class="task-comment-actions">
            <button type="button" class="btn btn-ghost btn-s" (click)="editing.set(null)">Cancel</button>
            <button type="button" class="btn btn-primary btn-s" [disabled]="!edited().trim()" (click)="saveEdit()">Save</button>
          </div>
        } @else {
          <gd-markdown
            class="task-comment-body"
            [source]="comment.body"
            [path]="task().path"
            [links]="wiki.linkTargets()"
            (linkClicked)="wiki.followLink($event)"
          />
        }
      </article>
    }
    <div class="task-composer">
      <textarea
        #composer
        class="textarea"
        aria-label="New comment"
        placeholder="Add a comment… Markdown and [[references]] work."
        [value]="draft()"
        (input)="draft.set(composer.value)"
        (keydown)="composeKey($event, composer)"
      ></textarea>
      <div class="task-comment-actions">
        <button type="button" class="btn btn-primary btn-s" [disabled]="!draft().trim() || sending()" (click)="send()">
          <span>Comment</span><kbd class="kbd">{{ mod }} ↵</kbd>
        </button>
      </div>
    </div>
  `,
})
export class TaskComments {
  readonly task = input.required<Task>();
  /** The task as saved after a comment changed. */
  readonly changed = output<Task>();

  protected readonly wiki = inject(WikiActions);
  private readonly api = inject(WorkspaceApi);
  private readonly session = inject(Session);
  private readonly dialogs = inject(Dialogs);
  protected readonly mod = MOD_KEY;
  protected readonly relativeTime = relativeTime;

  private readonly taskId = computed(() => this.task().id);
  /** The name the user's comments are signed with; null until known. */
  protected readonly author = signal<string | null>(null);
  protected readonly draft = signal("");
  protected readonly sending = signal(false);
  /**
   * The comment being edited, by index, with the version of the task and the
   * text it started from: comments are saved by index, so a save fails rather
   * than hit another comment when the task changed meanwhile.
   */
  protected readonly editing = signal<CommentVersion | null>(null);
  protected readonly edited = signal("");
  /** A comment written or edited but not saved. */
  readonly dirty = computed(() => !!this.draft().trim() || (!!this.editing() && this.edited() !== this.editing()!.body));

  constructor() {
    effect(() => {
      // Once per repository.
      if (this.session.id()) untracked(() => void this.loadAuthor());
    });
    effect(() => {
      // Another task starts without a draft (a move to another epic keeps the ID).
      this.taskId();
      untracked(() => {
        this.draft.set("");
        this.editing.set(null);
      });
    });
    trackUnsaved(this.dirty);
  }

  /** Drops the unsent comment and the edit in progress. */
  discard(): void {
    this.draft.set("");
    this.editing.set(null);
  }

  private async loadAuthor() {
    this.author.set(await this.api.content.commentAuthor().catch(() => null));
  }

  protected localTime(iso: string): string {
    return new Date(iso).toLocaleString();
  }

  /** Ctrl+Enter sends; Escape keeps an unsent comment instead of closing the task. */
  protected composeKey(event: KeyboardEvent, field: HTMLTextAreaElement) {
    if (matchesHotkey("mod+enter", event)) {
      event.preventDefault();
      void this.send();
    } else if (event.key === "Escape" && this.draft().trim()) {
      event.stopPropagation();
      field.blur();
    }
  }

  protected editKey(event: KeyboardEvent) {
    if (matchesHotkey("mod+enter", event)) {
      event.preventDefault();
      void this.saveEdit();
    } else if (event.key === "Escape") {
      event.stopPropagation();
      this.editing.set(null);
    }
  }

  protected async send() {
    const text = this.draft();
    if (!text.trim() || this.sending()) return;
    this.sending.set(true);
    try {
      const saved = await this.session.run(() => this.api.content.addComment(this.task().path, text));
      if (!saved) return;
      this.draft.set("");
      this.report(saved);
    } finally {
      this.sending.set(false);
    }
  }

  protected startEditing(index: number) {
    const { path, hash, comments } = this.task();
    const body = comments[index]!.body;
    this.edited.set(body);
    this.editing.set({ index, path, hash, body });
  }

  protected async saveEdit() {
    const editing = this.editing();
    const text = this.edited();
    if (!editing || !text.trim()) return;
    const saved = await this.session.run(() => this.api.content.editComment(editing.path, editing.index, text, editing.hash));
    if (!saved) return;
    this.editing.set(null);
    this.report(saved);
  }

  protected async remove(index: number) {
    // The version the user saw: a refresh while the dialog is open may move the comments.
    const { path, hash } = this.task();
    const confirmed = await this.dialogs.confirm({
      title: "Delete comment",
      message: "Delete this comment? Git history keeps it.",
      confirm: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    const saved = await this.session.run(() => this.api.content.deleteComment(path, index, hash));
    if (saved) this.report(saved);
  }

  private report(saved: Task) {
    this.changed.emit(saved);
    this.session.contentChanged();
  }
}
