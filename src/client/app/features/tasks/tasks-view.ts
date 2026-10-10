import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, input, signal, viewChild, ViewEncapsulation } from "@angular/core";
import { Router } from "@angular/router";
import {
  LucideColumns3,
  LucideFolder,
  LucideLayoutList,
  LucideListFilter,
  LucidePlus,
  LucideRows3,
  LucideSearch,
  LucideTag,
  LucideUser,
  LucideX,
} from "@lucide/angular";
import { PRIORITIES, type Task } from "../../../../contracts/model";
import { hotkey } from "../../core/hotkeys";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { Avatar } from "../../ui/avatar";
import { EmptyState } from "../../ui/empty-state";
import { MenuItem } from "../../ui/menu-item";
import { recall, remember } from "../../ui/remembered";
import { TaskBoard } from "./task-board";
import { PriorityIcon } from "./task-icons";
import { TaskList } from "./task-list";
import {
  columnsOf,
  epicName,
  epicsOf,
  inputOf,
  labelsOf,
  lanesOf,
  NO_FILTERS,
  peopleOf,
  titleCase,
  UNASSIGNED,
  visibleTasks,
  type Placement,
  type TaskFilters,
} from "./task-model";
import { TaskPanel } from "./task-panel";

type Layout = "board" | "list";
const LAYOUT_KEY = "tasks:layout";
const LANES_KEY = "tasks:lanes";


/**
 * The task board or list, with filters. `?task=` opens a task in the
 * drawer, `?create=<state>` starts a new one. Styles are global but
 * namespaced, so the feature's sub-components share them.
 */
@Component({
  selector: "gd-tasks-view",
  imports: [
    CdkMenu, CdkMenuTrigger, Avatar, EmptyState, MenuItem, PriorityIcon, TaskBoard, TaskList, TaskPanel,
    LucideColumns3, LucideFolder, LucideLayoutList, LucideListFilter, LucidePlus, LucideRows3, LucideSearch, LucideTag, LucideUser, LucideX,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./tasks.css",
  host: { class: "view tasks-view" },
  templateUrl: "./tasks-view.html",
})
export class TasksView {
  readonly task = input<string>();
  readonly create = input<string>();
  /** The epic a new task starts in (with `create`). */
  readonly epic = input<string>();

  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly titleCase = titleCase;
  protected readonly priorities = PRIORITIES;
  protected readonly unassigned = UNASSIGNED;
  protected readonly layout = signal<Layout>((recall(LAYOUT_KEY) === "list" ? "list" : "board"));
  /** Swimlanes per epic on the board. */
  protected readonly swimlanes = signal(recall(LANES_KEY) === "on");
  protected readonly filters = signal<TaskFilters>(NO_FILTERS);
  private readonly moving = signal<ReadonlyMap<string, Placement>>(new Map());
  /** Hidden columns as the user left them, while their saves run; null when the snapshot has them. */
  private readonly hiding = signal<readonly string[] | null>(null);
  /** Column choices save one after another, each on the newest settings. */
  private columnSaves: Promise<unknown> = Promise.resolve();
  private pendingColumnSaves = 0;
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>("search");

  protected readonly snapshot = computed(() => this.session.snapshot()!);
  protected readonly statuses = computed(() => this.snapshot().settings.statuses);
  protected readonly tasks = computed(() => visibleTasks(this.snapshot().tasks, this.filters(), this.moving()));
  protected readonly columns = computed(() => columnsOf(this.statuses(), this.snapshot().tasks));
  protected readonly hidden = computed(() => this.hiding() ?? this.snapshot().settings.hiddenColumns);
  protected readonly boardColumns = computed(() => this.columns().filter((status) => !this.hidden().includes(status)));
  protected readonly epics = computed(() => epicsOf(this.snapshot().tasks));
  protected readonly lanes = computed(() => (this.swimlanes() && this.epics().length ? lanesOf(this.snapshot().tasks) : null));
  protected readonly people = computed(() => peopleOf(this.snapshot().tasks));
  protected readonly labels = computed(() => labelsOf(this.snapshot().tasks));
  protected readonly selected = computed(() => {
    const id = this.task();
    return id ? this.snapshot().tasks.find((task) => task.id === id) : undefined;
  });
  protected readonly chips = computed(() => {
    const { assignee, priority, label, epic } = this.filters();
    return [
      ...(epic !== null ? [{ key: "epic" as const, text: epicName(epic) }] : []),
      ...(assignee ? [{ key: "assignee" as const, text: assignee === UNASSIGNED ? "Unassigned" : assignee }] : []),
      ...(priority ? [{ key: "priority" as const, text: titleCase(priority) }] : []),
      ...(label ? [{ key: "label" as const, text: label }] : []),
    ];
  });

  constructor() {
    hotkey("c", () => void this.startTask(), computed(() => !this.task() && !this.create()));
    hotkey("/", () => this.search().nativeElement.focus());
  }

  protected setLayout(layout: Layout) {
    this.layout.set(layout);
    remember(LAYOUT_KEY, layout);
  }

  protected toggleSwimlanes() {
    this.swimlanes.update((on) => !on);
    remember(LANES_KEY, this.swimlanes() ? "on" : "off");
  }

  /**
   * Board columns are shared: the choice is saved in the project settings.
   * It shows at once; when its save fails, the column returns.
   */
  protected setColumnVisible({ status, visible }: { status: string; visible: boolean }): Promise<unknown> {
    const apply = (hidden: readonly string[]) => [...hidden.filter((other) => other !== status), ...(visible ? [] : [status])];
    this.hiding.set(apply(this.hidden()));
    this.pendingColumnSaves++;
    return (this.columnSaves = this.columnSaves.then(async () => {
      const { settings, settingsHash } = this.snapshot();
      const saved = await this.session.run(async () => (await this.api.content.saveSettings({ ...settings, hiddenColumns: apply(settings.hiddenColumns) }, settingsHash), true));
      if (saved) this.session.contentChanged();
      // The last save refreshed the snapshot, which now has every choice that was saved.
      if (--this.pendingColumnSaves === 0) this.hiding.set(null);
    }));
  }

  protected setQuery(query: string) {
    this.filters.update((filters) => ({ ...filters, query }));
  }

  protected clearQuery(field: HTMLInputElement) {
    this.setQuery("");
    field.blur();
  }

  /** Selecting the active value again clears it. */
  protected toggleFilter(key: "assignee" | "priority" | "label" | "epic", value: string) {
    this.filters.update((filters) => ({ ...filters, [key]: filters[key] === value ? null : value }));
  }

  protected clearFilter(key: "assignee" | "priority" | "label" | "epic") {
    this.filters.update((filters) => ({ ...filters, [key]: null }));
  }

  protected open(task: Task) {
    void this.router.navigate(["/tasks"], { queryParams: { task: task.id } });
  }

  protected startTask(status = this.statuses()[0], epic?: string) {
    return this.router.navigate(["/tasks"], { queryParams: { create: status, epic: epic || null } });
  }

  protected closePanel() {
    void this.router.navigate(["/tasks"]);
  }

  protected closeMissing() {
    void this.router.navigate(["/tasks"], { replaceUrl: true });
  }

  /** Shows the card in its new place at once; it returns if saving fails. */
  protected async move({ task, status, epic }: { task: Task } & Placement) {
    if ((task.status === status && task.epic === epic) || !this.statuses().includes(status)) return;
    this.moving.update((moving) => new Map(moving).set(task.path, { status, epic }));
    const saved = await this.session.run(() => this.api.content.updateTask(task.path, { ...inputOf(task), status, epic }, task.hash));
    if (saved) this.session.contentChanged();
    this.moving.update((moving) => {
      const next = new Map(moving);
      next.delete(task.path);
      return next;
    });
  }
}
