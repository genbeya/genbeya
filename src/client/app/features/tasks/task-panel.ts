import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import {
  afterNextRender,
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { Router } from "@angular/router";
import type { LinkItem } from "../../../../contracts/genbeya-link";
import type { FieldValue, Task, TaskInput, TaskTemplate } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Clipboard } from "../../core/clipboard";
import { hotkey, MOD_KEY } from "../../core/hotkeys";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { ShareLinks } from "../../core/share-links";
import { trackUnsaved } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import { CodeEditor } from "../../editor/code-editor";
import { MarkdownView } from "../../markdown/markdown-view";
import { toggleCheckboxAt } from "../../markdown/task-checkbox";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";
import { WikiActions } from "../wiki/wiki-actions";
import { RepositoryActions } from "../shell/repository-actions";
import { TaskActivity } from "./task-activity";
import { branchesOfTask, branchNameFor } from "./task-branches";
import { TaskComments } from "./task-comments";
import { type FieldChange, TaskFields } from "./task-fields";
import { TaskPlan } from "./task-plan";
import { addTimeEntry, parseEffort } from "../../../../utilities/planning";
import { today } from "../../ui/calendar-date";
import { displayId, inputOf } from "./task-model";
import { TaskProperties } from "./task-properties";

/** How long field changes rest before they are saved, together: a date or number typed digit by digit saves once. */
export const FIELD_DELAY = 600;

const TABS = ["comments", "activity"] as const;
type Tab = (typeof TABS)[number];

const empty = (status: string, epic = ""): TaskInput => ({ title: "", status, priority: "none", assignee: "", labels: [], body: "", epic });

/** What a template put into a new task's draft. */
type FromTemplate = Partial<Pick<TaskInput, "body" | "priority" | "assignee" | "labels" | "fields">>;

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * `draft` with the template's description where it has none, and its presets
 * where the draft has none; with what the template put in.
 */
function withTemplate(draft: TaskInput, template: TaskTemplate): { draft: TaskInput; applied: FromTemplate } {
  const applied: { -readonly [K in keyof FromTemplate]: FromTemplate[K] } = {};
  if (!draft.body.trim() && template.body) applied.body = template.body;
  if (draft.priority === "none" && template.priority && template.priority !== "none") applied.priority = template.priority;
  if (!draft.assignee && template.assignee) applied.assignee = template.assignee;
  if (!draft.labels.length && template.labels?.length) applied.labels = template.labels;
  const fields = Object.entries(template.fields ?? {}).filter(([name]) => (draft.fields?.[name] ?? "") === "");
  if (fields.length) applied.fields = Object.fromEntries(fields);
  return { draft: { ...draft, ...applied, fields: { ...draft.fields, ...applied.fields } }, applied };
}

/** `draft` without what a template put in, except what the user has changed since. */
function withoutTemplate(draft: TaskInput, applied: FromTemplate): TaskInput {
  const kept = <K extends keyof FromTemplate>(key: K, cleared: TaskInput[K]) =>
    applied[key] !== undefined && sameValue(draft[key], applied[key]) ? cleared : draft[key];
  const fields = Object.entries(draft.fields ?? {}).filter(([name, value]) => applied.fields?.[name] !== value);
  return {
    ...draft,
    body: kept("body", "")!,
    priority: kept("priority", "none")!,
    assignee: kept("assignee", "")!,
    labels: kept("labels", [])!,
    ...(draft.fields ? { fields: Object.fromEntries(fields) } : {}),
  };
}

/**
 * The task drawer. Viewing renders the description and saves property
 * changes at once; E edits title and description; without a task it creates one.
 */
@Component({
  selector: "gd-task-panel",
  imports: [
    CdkMenu,
    CdkMenuTrigger,
    CodeEditor,
    Icon,
    MarkdownView,
    MenuItem,
    TaskActivity,
    TaskComments,
    TaskFields,
    TaskPlan,
    TaskProperties,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "task-panel", role: "dialog", tabindex: "-1", "[attr.aria-label]": "task() ? 'Task ' + task()!.id : 'New task'" },
  template: `
    <header class="task-panel-header">
      <span class="task-panel-id mono">{{ task() ? displayId(task()!.id) : "New task" }}</span>
      @if (dirty()) {
        <span class="dirty-dot" title="Unsaved changes" aria-label="Unsaved changes"></span>
      }
      <span class="grow"></span>
      @if (editing()) {
        <button type="button" class="btn btn-ghost btn-m" (click)="cancel()"><span>Cancel</span></button>
        <button type="button" class="btn btn-primary btn-m" (click)="save()">
          <span>{{ task() ? "Save" : "Create task" }}</span
          ><kbd class="kbd">{{ mod }} S</kbd>
        </button>
      } @else {
        <button type="button" class="btn btn-default btn-m" (click)="startEditing()">
          <svg gd-icon name="pencil" [size]="13"></svg><span>Edit</span><kbd class="kbd">E</kbd>
        </button>
        <button
          type="button"
          class="icon-btn"
          aria-label="Task actions"
          title="Task actions"
          [cdkMenuTriggerFor]="actions"
          #trigger="cdkMenuTriggerFor"
          [class.is-active]="trigger.isOpen()"
        >
          <svg gd-icon name="ellipsis" [size]="16"></svg>
        </button>
      }
      <button type="button" class="icon-btn" aria-label="Close (Esc)" title="Close (Esc)" (click)="close()">
        <svg gd-icon name="x" [size]="16"></svg>
      </button>
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
      <gd-task-fields [value]="shown()" (changed)="setField($event)" />
      @if (task() && !editing()) {
        <gd-task-plan [task]="current()!" (logTime)="logTime()" />
      }
      @if (task() && !editing() && branches().length) {
        <div class="task-branches" role="group" aria-label="Branches of this task">
          @for (branch of branches(); track branch.name) {
            @if (branch.name === head()) {
              <span class="property is-current" title="The checked-out branch">
                <svg gd-icon name="git-branch" [size]="13"></svg>{{ branch.name }}
              </span>
            } @else {
              <button
                type="button"
                class="property"
                [title]="branch.remote ? 'Check out ' + branch.name : 'Switch to ' + branch.name"
                (click)="repository.switchBranch(branch.name)"
              >
                <svg gd-icon name="git-branch" [size]="13"></svg>{{ branch.name }}
              </button>
            }
          }
        </div>
      }
      <div class="task-description" [class.is-viewing]="!editing()">
        @if (editing()) {
          <div class="task-body-editor">
            <gd-code-editor
              label="Task description"
              [path]="(task()?.path ?? 'new-task') + '.md'"
              [value]="draft().body"
              [references]="wiki.referenceCandidates()"
              [people]="wiki.people()"
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
      @if (task()) {
        <!-- Hidden rather than removed while editing, and the comments while showing the activity, so an unsent comment survives. -->
        <section class="task-discussion" [class.is-hidden]="editing()">
          <div class="segmented" role="tablist" aria-label="Comments and activity">
            @for (name of tabs; track name) {
              <button
                type="button"
                role="tab"
                [id]="'task-tab-' + name"
                [attr.aria-controls]="'task-tabpanel-' + name"
                [attr.aria-selected]="tab() === name"
                [tabIndex]="tab() === name ? 0 : -1"
                [class.is-active]="tab() === name"
                (click)="tab.set(name)"
                (keydown)="tabKey($event)"
              >
                @if (name === "comments") {
                  Comments
                  @if (current()!.comments.length) {
                    <span class="faint">{{ current()!.comments.length }}</span>
                  }
                } @else {
                  Activity
                }
              </button>
            }
          </div>
          <gd-task-comments
            id="task-tabpanel-comments"
            role="tabpanel"
            aria-labelledby="task-tab-comments"
            [class.is-hidden]="tab() !== 'comments'"
            [task]="current()!"
            (changed)="saved.set($event)"
          />
          <div id="task-tabpanel-activity" role="tabpanel" aria-labelledby="task-tab-activity" [hidden]="tab() !== 'activity'">
            @if (tab() === "activity") {
              <gd-task-activity [task]="current()!" />
            }
          </div>
        </section>
      }
    </div>

    <ng-template #actions>
      <div class="menu" cdkMenu>
        <button gd-menu-item (selected)="copyId()"><svg icon gd-icon name="copy" [size]="14"></svg>Copy ID</button>
        <button
          gd-menu-item
          [disabled]="!!links.unavailable()"
          [attr.title]="links.unavailable()"
          (selected)="links.copyGenbeyaLink(link())"
        >
          <svg icon gd-icon name="link" [size]="14"></svg>Copy Genbeya link
        </button>
        @if (links.webLink(link())) {
          <button gd-menu-item (selected)="links.copyWebLink(link())">
            <svg icon gd-icon name="globe" [size]="14"></svg>Copy web link
          </button>
        }
        <button gd-menu-item (selected)="createBranch()"><svg icon gd-icon name="git-branch-plus" [size]="14"></svg>Create branch…</button>
        <button gd-menu-item (selected)="openFile()"><svg icon gd-icon name="code-xml" [size]="14"></svg>Open file</button>
        <div class="menu-separator"></div>
        <button gd-menu-item [danger]="true" (selected)="remove()"><svg icon gd-icon name="trash-2" [size]="14"></svg>Delete task…</button>
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
  protected readonly links = inject(ShareLinks);
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly clipboard = inject(Clipboard);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);
  protected readonly mod = MOD_KEY;
  protected readonly displayId = displayId;

  /** A save's result, until the snapshot catches up with it. */
  protected readonly saved = signal<Task | null>(null);
  protected readonly tabs = TABS;
  protected readonly tab = signal<Tab>("comments");
  private readonly comments = viewChild(TaskComments);
  protected readonly current = computed(() => this.saved() ?? this.task() ?? null);
  protected readonly repository = inject(RepositoryActions);
  /** Branches named after the task, such as `GENBEYA-32-branch-links`. */
  protected readonly branches = computed(() => {
    const task = this.current();
    const snapshot = this.session.snapshot();
    return task && snapshot ? branchesOfTask(task.id, snapshot.branches, snapshot.remoteBranches) : [];
  });
  protected readonly head = computed(() => this.session.snapshot()?.head.branch ?? null);
  /** The actions menu only exists for a task. */
  protected readonly link = computed<LinkItem>(() => ({ kind: "task", id: this.current()!.id }));
  /** The file and its version: moving the task to another epic keeps the content, but not the path. */
  private readonly taskVersion = computed(
    () =>
      this.task() &&
      `${this.task()!.path}
${this.task()!.hash}`,
  );
  protected readonly editing = signal(false);
  protected readonly draft = signal<TaskInput>(empty(""));
  private readonly base = signal("");
  protected readonly dirty = computed(() => this.editing() && JSON.stringify(this.draft()) !== this.base());
  /** Field changes not saved yet; they show meanwhile. */
  private readonly pendingFields = signal<Readonly<Record<string, FieldValue>>>({});
  private fieldTimer: ReturnType<typeof setTimeout> | undefined;
  protected readonly shown = computed(() => {
    if (this.editing() || !this.current()) return this.draft();
    const shown = inputOf(this.current()!);
    const pending = this.pendingFields();
    return Object.keys(pending).length ? { ...shown, fields: { ...shown.fields, ...pending } } : shown;
  });
  /** The task an edit started from: saving fails if the file changed since. */
  private editBase: Task | null = null;
  /** What the last template put into a new task, taken back when the type changes unless the user changed it since. */
  private fromTemplate: FromTemplate = {};
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
    // An opened task takes focus, so the keyboard goes on in the panel rather than on the card that opened it.
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (this.task() && !host.contains(document.activeElement)) host.focus();
    });
    trackUnsaved(this.dirty);
    // Field changes still resting are saved when the panel closes.
    inject(DestroyRef).onDestroy(() => this.saveFields());
    hotkey(
      "e",
      () => this.startEditing(),
      computed(() => !this.editing() && !!this.task()),
    );
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
    this.saveFields();
    this.editBase = task;
    this.begin(this.shown());
  }

  protected setTitle(title: string) {
    this.draft.update((draft) => ({ ...draft, title: title.replace(/\n/g, " ") }));
  }

  protected setBody(body: string) {
    this.draft.update((draft) => ({ ...draft, body }));
  }

  protected async cancel() {
    if (this.dirty() && !(await this.dialogs.discardEdits("this task"))) return;
    this.base.set(JSON.stringify(this.draft()));
    if (this.task()) this.editing.set(false);
    else await this.close();
  }

  /** Asks once before discarding an edit or an unsent comment, then leaves; the route's own guard finds nothing left to ask about. */
  protected async close() {
    const comments = this.comments();
    const unsentComment = !!comments?.dirty();
    if (unsentComment || this.dirty()) {
      if (!(await this.dialogs.discardEdits(this.dirty() ? "this task" : "this comment"))) return;
      comments?.discard();
      this.base.set(JSON.stringify(this.draft()));
    }
    await this.router.navigate(["/tasks"]);
  }

  /** Arrow keys, Home and End move between the tabs, as in every tab list. */
  protected tabKey(event: KeyboardEvent) {
    const index = this.tabs.indexOf(this.tab());
    const last = this.tabs.length - 1;
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: last }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const tab = this.tabs[(next + this.tabs.length) % this.tabs.length]!;
    this.tab.set(tab);
    (event.currentTarget as HTMLElement).parentElement!.querySelector<HTMLElement>(`#task-tab-${tab}`)?.focus();
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
      // Moving a task to another epic keeps its file, so it may have moved meanwhile; the edit keeps that unless it moves it too.
      const draft = this.draft();
      const input = this.editBase && draft.epic === this.editBase.epic ? { ...draft, epic: task.epic } : draft;
      // The result applies before the snapshot refresh, so the task is clean at once.
      const updated = await this.session.run(async () => {
        const result = await this.api.content.updateTask(task.path, input, this.editBase?.hash ?? task.hash);
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
    if (this.editing() || !this.current()) {
      this.draft.update((draft) => ({ ...draft, ...change }));
      if (!this.task() && change.type) void this.applyTemplate(change.type);
      return;
    }
    this.enqueue(() => change);
  }

  /**
   * A custom field's change. While viewing, changes rest for a moment and are
   * then saved together, merged into the fields of the newest version, so
   * quick changes to two fields keep both.
   */
  protected setField({ name, value }: FieldChange) {
    if (this.editing() || !this.current()) {
      this.draft.update((draft) => ({ ...draft, fields: { ...draft.fields, [name]: value } }));
      return;
    }
    this.pendingFields.update((pending) => ({ ...pending, [name]: value }));
    clearTimeout(this.fieldTimer);
    this.fieldTimer = setTimeout(() => this.saveFields(), FIELD_DELAY);
  }

  private saveFields() {
    clearTimeout(this.fieldTimer);
    const fields = this.pendingFields();
    if (!Object.keys(fields).length) return;
    void this.enqueue((task) => ({ fields: { ...task.fields, ...fields } })).then(() =>
      // Changed again meanwhile, a field stays pending with its newer value.
      this.pendingFields.update((pending) => Object.fromEntries(Object.entries(pending).filter(([name, value]) => fields[name] !== value))),
    );
  }

  /**
   * A new task of a type starts from the type's template: its description,
   * unless someone wrote one already, and its presets where the task has
   * none. Another type takes back what the previous template put in and the
   * user left as it was.
   */
  private async applyTemplate(type: string) {
    const template = await this.session.run(() => this.api.content.taskTemplate(type));
    if (this.draft().type !== type) return;
    const draft = withoutTemplate(this.draft(), this.fromTemplate);
    const next = template ? withTemplate(draft, template) : { draft, applied: {} };
    this.fromTemplate = next.applied;
    this.draft.set(next.draft);
  }

  /** Asks for the time spent and what for, and adds it last to the task's time log, signed like comments. */
  protected async logTime() {
    const hoursOf = (text: string) => parseEffort(text.trim().split(/\s+/)[0]);
    const value = await this.dialogs.prompt({
      title: "Log time",
      label: "Time spent, then what for",
      placeholder: "2h Reviewed the token validation",
      hint: "Hours or days (2h, 0.5d), then a note. The entry goes into the task's time log, signed with your Git name.",
      confirm: "Log",
      validate: (text) => (hoursOf(text) ? null : "Start with the time spent, such as 2h or 0.5d."),
    });
    if (!value) return;
    const author = await this.session.run(() => this.api.content.commentAuthor());
    if (!author) return;
    const note = value.trim().split(/\s+/).slice(1).join(" ");
    await this.enqueue((task) => ({ body: addTimeEntry(task.body, { date: today(), author, hours: hoursOf(value)!, note }) }));
  }

  protected toggleCheckbox(offset: number) {
    this.enqueue((task) => ({ body: toggleCheckboxAt(task.body, offset) }));
  }

  private enqueue(change: (task: Task) => Partial<TaskInput>): Promise<unknown> {
    return (this.queue = this.queue.then(async () => {
      const task = this.current();
      if (!task) return;
      const updated = await this.session.run(() =>
        this.api.content.updateTask(task.path, { ...inputOf(task), ...change(task) }, task.hash),
      );
      if (!updated) return;
      this.saved.set(updated);
      this.session.contentChanged();
    }));
  }

  /** Creates a branch named after the task and switches to it. */
  protected createBranch() {
    const task = this.current();
    if (task) void this.repository.createBranch(branchNameFor(task.id, task.title));
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
