import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, type ElementRef, inject, input, signal, viewChild, ViewEncapsulation } from "@angular/core";
import { Router } from "@angular/router";
import { LucideColumns3, LucideLayoutList, LucideListFilter, LucidePlus, LucideSearch, LucideTag, LucideUser, LucideX } from "@lucide/angular";
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
import { columnsOf, inputOf, labelsOf, NO_FILTERS, peopleOf, titleCase, UNASSIGNED, visibleTasks, type TaskFilters } from "./task-model";
import { TaskPanel } from "./task-panel";

type Layout = "board" | "list";
const LAYOUT_KEY = "tasks:layout";


/**
 * The task board or list, with filters. `?task=` opens a task in the
 * drawer, `?create=<state>` starts a new one. Styles are global but
 * namespaced, so the feature's sub-components share them.
 */
@Component({
  selector: "gd-tasks-view",
  imports: [
    CdkMenu, CdkMenuTrigger, Avatar, EmptyState, MenuItem, PriorityIcon, TaskBoard, TaskList, TaskPanel,
    LucideColumns3, LucideLayoutList, LucideListFilter, LucidePlus, LucideSearch, LucideTag, LucideUser, LucideX,
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

  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly titleCase = titleCase;
  protected readonly priorities = PRIORITIES;
  protected readonly unassigned = UNASSIGNED;
  protected readonly layout = signal<Layout>((recall(LAYOUT_KEY) === "list" ? "list" : "board"));
  protected readonly filters = signal<TaskFilters>(NO_FILTERS);
  private readonly moving = signal<ReadonlyMap<string, string>>(new Map());
  private readonly search = viewChild.required<ElementRef<HTMLInputElement>>("search");

  protected readonly snapshot = computed(() => this.session.snapshot()!);
  protected readonly statuses = computed(() => this.snapshot().settings.statuses);
  protected readonly tasks = computed(() => visibleTasks(this.snapshot().tasks, this.filters(), this.moving()));
  protected readonly columns = computed(() => columnsOf(this.statuses(), this.snapshot().tasks));
  protected readonly people = computed(() => peopleOf(this.snapshot().tasks));
  protected readonly labels = computed(() => labelsOf(this.snapshot().tasks));
  protected readonly selected = computed(() => {
    const id = this.task();
    return id ? this.snapshot().tasks.find((task) => task.id === id) : undefined;
  });
  protected readonly chips = computed(() => {
    const { assignee, priority, label } = this.filters();
    return [
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

  protected setQuery(query: string) {
    this.filters.update((filters) => ({ ...filters, query }));
  }

  protected clearQuery(field: HTMLInputElement) {
    this.setQuery("");
    field.blur();
  }

  /** Selecting the active value again clears it. */
  protected toggleFilter(key: "assignee" | "priority" | "label", value: string) {
    this.filters.update((filters) => ({ ...filters, [key]: filters[key] === value ? null : value }));
  }

  protected clearFilter(key: "assignee" | "priority" | "label") {
    this.filters.update((filters) => ({ ...filters, [key]: null }));
  }

  protected open(task: Task) {
    void this.router.navigate(["/tasks"], { queryParams: { task: task.id } });
  }

  protected startTask(status = this.statuses()[0]) {
    return this.router.navigate(["/tasks"], { queryParams: { create: status } });
  }

  protected closePanel() {
    void this.router.navigate(["/tasks"]);
  }

  protected closeMissing() {
    void this.router.navigate(["/tasks"], { replaceUrl: true });
  }

  /** Shows the card in its new column at once; it returns if saving fails. */
  protected async move({ task, status }: { task: Task; status: string }) {
    if (task.status === status || !this.statuses().includes(status)) return;
    this.moving.update((moving) => new Map(moving).set(task.path, status));
    const saved = await this.session.run(() => this.api.content.updateTask(task.path, { ...inputOf(task), status }, task.hash));
    if (saved) this.session.contentChanged();
    this.moving.update((moving) => {
      const next = new Map(moving);
      next.delete(task.path);
      return next;
    });
  }
}
