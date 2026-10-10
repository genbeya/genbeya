import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { afterRenderEffect, ChangeDetectionStrategy, Component, computed, effect, type ElementRef, inject, input, signal, untracked, viewChild } from "@angular/core";
import { Router } from "@angular/router";
import { LucideCodeXml, LucideCopy, LucideEllipsis, LucidePencil, LucideTrash2, LucideX } from "@lucide/angular";
import type { Task, TaskInput } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Clipboard } from "../../core/clipboard";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor } from "../../editor/code-editor";
import { MarkdownView } from "../../markdown/markdown-view";
import { toggleCheckboxAt } from "../../markdown/task-checkbox";
import { MenuItem } from "../../ui/menu-item";
import { WikiActions } from "../wiki/wiki-actions";
import { displayId, inputOf } from "./task-model";
import { TaskProperties } from "./task-properties";

const empty = (status: string, epic = ""): TaskInput => ({ title: "", status, priority: "none", assignee: "", labels: [], body: "", epic });

/**
 * The task drawer. Viewing renders the description and saves property
 * changes at once; E edits title and description; without a task it creates one.
 */
@Component({
  selector: "gd-task-panel",
  imports: [CdkMenu, CdkMenuTrigger, CodeEditor, MarkdownView, MenuItem, TaskProperties, LucideCodeXml, LucideCopy, LucideEllipsis, LucidePencil, LucideTrash2, LucideX],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-panel", role: "dialog", "[attr.aria-label]": "task() ? 'Task ' + task()!.id : 'New task'" },
  template: `
    <header class="task-panel-header">
      <span class="task-panel-id mono">{{ task() ? displayId(task()!.id) : "New task" }}</span>
      @if (dirty()) {
        <span class="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>
      }
      <span class="grow"></span>
      @if (editing()) {
        <button type="button" class="btn btn-ghost btn-m" (click)="cancel()"><span>Cancel</span></button>
        <button type="button" class="btn btn-primary btn-m" (click)="save()"><span>{{ task() ? "Save" : "Create task" }}</span><kbd class="kbd">{{ mod }} S</kbd></button>
      } @else {
        <button type="button" class="btn btn-default btn-m" (click)="startEditing()">
          <svg lucidePencil [size]="13" aria-hidden="true"></svg><span>Edit</span><kbd class="kbd">E</kbd>
        </button>
        <button type="button" class="icon-btn" aria-label="Task actions" title="Task actions" [cdkMenuTriggerFor]="actions" #trigger="cdkMenuTriggerFor" [class.is-active]="trigger.isOpen()">
          <svg lucideEllipsis [size]="16" aria-hidden="true"></svg>
        </button>
      }
      <button type="button" class="icon-btn" aria-label="Close (Esc)" title="Close (Esc)" (click)="close()"><svg lucideX [size]="16" aria-hidden="true"></svg></button>
    </header>
    <div class="task-panel-body">
      @if (editing()) {
        <textarea
          #title
          class="task-title-input"
          rows="1"
          placeholder="Task title"
          aria-label="Task title"
          [value]="draft().title"
          (input)="setTitle(title.value)"
          (keydown.enter)="$event.preventDefault()"
        ></textarea>
      } @else {
        <h1 class="task-title selectable">{{ current()!.title }}</h1>
      }
      <gd-task-properties [value]="shown()" (changed)="patch($event)" />
      <div class="task-description">
        @if (editing()) {
          <div class="task-body-editor">
            <gd-code-editor
              label="Task description"
              [path]="(task()?.path ?? 'new-task') + '.md'"
              [value]="draft().body"
              [lineNumbers]="false"
              [autofocus]="!!task()"
              (valueChange)="setBody($event)"
              (save)="save()"
            />
          </div>
        } @else if (current()!.body.trim()) {
          <gd-markdown
            class="task-markdown"
            [source]="current()!.body"
            [path]="current()!.path"
            [links]="wiki.linkTargets()"
            [checkboxes]="true"
            (linkClicked)="wiki.followLink($event)"
            (checkboxToggled)="toggleCheckbox($event)"
          />
        } @else {
          <button type="button" class="task-empty-body" (click)="startEditing()">Add a description…</button>
        }
      </div>
    </div>

    <ng-template #actions>
      <div class="menu" cdkMenu>
        <button gd-menu-item (selected)="copyId()"><svg icon lucideCopy [size]="14" aria-hidden="true"></svg>Copy ID</button>
        <button gd-menu-item (selected)="openFile()"><svg icon lucideCodeXml [size]="14" aria-hidden="true"></svg>Open file</button>
        <div class="menu-separator"></div>
        <button gd-menu-item [danger]="true" (selected)="remove()"><svg icon lucideTrash2 [size]="14" aria-hidden="true"></svg>Delete task…</button>
      </div>
    </ng-template>
  `,
})
export class TaskPanel {
  /** The task as the snapshot has it; undefined to create one. */
  readonly task = input<Task>();
  /** The state a new task starts in. */
  readonly createStatus = input<string>();
  /** The epic a new task starts in. */
  readonly createEpic = input<string>();

  protected readonly wiki = inject(WikiActions);
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly clipboard = inject(Clipboard);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);
  protected readonly mod = MOD_KEY;
  protected readonly displayId = displayId;

  /** A save's result, until the snapshot catches up with it. */
  private readonly saved = signal<Task | null>(null);
  protected readonly current = computed(() => this.saved() ?? this.task() ?? null);
  private readonly taskVersion = computed(() => this.task()?.hash);
  protected readonly editing = signal(false);
  protected readonly draft = signal<TaskInput>(empty(""));
  private readonly base = signal("");
  protected readonly dirty = computed(() => this.editing() && JSON.stringify(this.draft()) !== this.base());
  protected readonly shown = computed(() => (this.editing() || !this.current() ? this.draft() : inputOf(this.current()!)));
  /** The version an edit started from: saving fails if the file changed since. */
  private editBase: string | null = null;
  private saving = false;
  /** Property changes while viewing save one after another, each on the newest version. */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly titleField = viewChild<ElementRef<HTMLTextAreaElement>>("title");

  constructor() {
    effect(() => {
      // A newer version from the snapshot replaces the saved one.
      this.taskVersion();
      untracked(() => this.saved.set(null));
    });
    effect(() => {
      // Creating starts in edit mode with an empty draft.
      if (!this.task())
        untracked(() => this.begin(empty(this.createStatus() ?? this.session.snapshot()!.settings.statuses[0]!, this.createEpic())));
    });
    // A new task starts with its title; an edit starts in the description.
    afterRenderEffect(() => {
      if (!this.task()) this.titleField()?.nativeElement.focus();
    });
    trackUnsaved(this.dirty);
    hotkey("e", () => this.startEditing(), computed(() => !this.editing() && !!this.task()));
    hotkey("escape", () => void (this.editing() ? this.cancel() : this.close()));
    hotkey(["mod+s", "mod+enter"], () => void this.save(), this.editing);
  }

  private begin(value: TaskInput) {
    this.draft.set(value);
    this.base.set(JSON.stringify(value));
    this.editing.set(true);
  }

  protected startEditing() {
    const task = this.current();
    if (!task) return;
    this.editBase = task.hash;
    this.begin(inputOf(task));
  }

  protected setTitle(title: string) {
    this.draft.update((draft) => ({ ...draft, title: title.replace(/\n/g, " ") }));
  }

  protected setBody(body: string) {
    this.draft.update((draft) => ({ ...draft, body }));
  }

  protected async cancel() {
    if (this.dirty() && !(await this.dialogs.discardEdits("this task"))) return;
    if (this.task()) this.editing.set(false);
    else await this.close();
  }

  protected async close() {
    await this.router.navigate(["/tasks"]);
  }

  protected async save() {
    if (!this.draft().title.trim()) return this.notifications.error("Give the task a title first.");
    if (this.saving) return;
    this.saving = true;
    try {
      const task = this.task();
      if (!task) {
        const created = await this.session.run(async () => {
          const result = await this.api.content.createTask(this.draft());
          this.base.set(JSON.stringify(this.draft()));
          return result;
        });
        if (!created) return;
        this.session.contentChanged();
        await this.router.navigate(["/tasks"], { queryParams: { task: created.id }, replaceUrl: true });
        return;
      }
      // The result applies before the snapshot refresh, so the task is clean at once.
      const updated = await this.session.run(async () => {
        const result = await this.api.content.updateTask(task.path, this.draft(), this.editBase ?? task.hash);
        this.saved.set(result);
        this.base.set(JSON.stringify(this.draft()));
        this.editing.set(false);
        return result;
      });
      if (updated) this.session.contentChanged();
    } finally {
      this.saving = false;
    }
  }

  /** Property edits: saved at once while viewing, into the draft while editing or creating. */
  protected patch(change: Partial<TaskInput>) {
    if (this.editing() || !this.current()) return this.draft.update((draft) => ({ ...draft, ...change }));
    this.enqueue(() => change);
  }

  protected toggleCheckbox(offset: number) {
    this.enqueue((task) => ({ body: toggleCheckboxAt(task.body, offset) }));
  }

  private enqueue(change: (task: Task) => Partial<TaskInput>) {
    this.queue = this.queue.then(async () => {
      const task = this.current();
      if (!task) return;
      const updated = await this.session.run(() => this.api.content.updateTask(task.path, { ...inputOf(task), ...change(task) }, task.hash));
      if (!updated) return;
      this.saved.set(updated);
      this.session.contentChanged();
    });
  }

  protected copyId() {
    void this.clipboard.copy(this.current()!.id, "ID");
  }

  protected openFile() {
    void this.router.navigate(["/code"], { queryParams: { file: this.current()!.path } });
  }

  protected async remove() {
    const task = this.current()!;
    const confirmed = await this.dialogs.confirm({
      title: "Delete task",
      message: `Delete ${displayId(task.id)} “${task.title}”? Git history keeps the file.`,
      confirm: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    const deleted = await this.session.run(async () => (await this.api.content.deleteTask(task.path), true), "Task deleted");
    if (!deleted) return;
    this.session.contentChanged();
    await this.close();
  }
}
