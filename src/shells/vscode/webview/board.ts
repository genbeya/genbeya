/**
 * The board webview, as the app's board: a column per workflow state,
 * optionally a swimlane per epic, and filters. Cards drag between columns
 * and lanes; a click opens the task in a popup, where it can be changed.
 */
import "./theme";
import {
  columnsOf,
  epicName,
  epicsOf,
  labelsOf,
  shownLanesOf,
  NO_FILTERS,
  peopleOf,
  titleCase,
  typesOf,
  UNASSIGNED,
  visibleTasks,
  type TaskFilters,
} from "../../../client/app/features/tasks/task-model";
import { PRIORITIES, type Task } from "../../../contracts/model";
import { Bridge } from "./bridge";
import { MarkdownRenderer } from "./markdown";
import type { MarkdownContext } from "./protocol";
import { avatar, element, labelChip, statusPill, TaskView, typeChip } from "./task";

const TASK_TYPE = "application/x-genbeya-task";
/** The value of a filter's "everything" option. */
const ALL = "\u0000";

/** What the board remembers across restarts: its layout and filters. */
interface BoardState {
  readonly lanes: boolean;
  readonly collapsed: readonly string[];
  readonly filters: TaskFilters;
}

const root = document.getElementById("root")!;
const popup = document.getElementById("popup") as HTMLDialogElement;
const popupBody = document.getElementById("popup-body")!;

let tasks: readonly Task[] = [];
let context: MarkdownContext | null = null;
/** The task the popup shows, by path. */
let shown: string | null = null;

const bridge = new Bridge((message) => {
  if (message.type !== "board") return;
  ({ tasks, context } = message);
  draw();
  if (!shown) return;
  const task = tasks.find((candidate) => candidate.path === shown);
  if (task) open(task);
  else popup.close();
});
const saved = bridge.state as Partial<BoardState> | undefined;
let state: BoardState = { lanes: saved?.lanes ?? false, collapsed: saved?.collapsed ?? [], filters: { ...NO_FILTERS, ...saved?.filters } };
const markdown = new MarkdownRenderer(bridge);
const taskView = new TaskView(bridge, markdown);
markdown.listen(popupBody);

function remember(change: Partial<BoardState>) {
  state = { ...state, ...change };
  bridge.state = state;
}

function update(change: Partial<BoardState>) {
  remember(change);
  draw();
}

const setFilter = (change: Partial<TaskFilters>) => update({ filters: { ...state.filters, ...change } });

function select(
  label: string,
  value: string | null,
  options: readonly (readonly [string, string])[],
  change: (value: string | null) => void,
) {
  const control = element("select", "gb-filter");
  control.setAttribute("aria-label", label);
  control.append(Object.assign(element("option", "", label), { value: ALL }));
  for (const [optionValue, text] of options) {
    control.append(Object.assign(element("option", "", text), { value: optionValue, selected: optionValue === value }));
  }
  control.classList.toggle("is-active", value !== null);
  control.addEventListener("change", () => change(control.value === ALL ? null : control.value));
  return control;
}

const pairs = (values: readonly string[]) => values.map((value) => [value, value] as const);

function toolbar(): HTMLElement {
  const bar = element("div", "gb-board-bar");
  const search = element("input", "gb-search");
  search.type = "search";
  search.placeholder = "Filter tasks";
  search.setAttribute("aria-label", "Filter tasks");
  search.value = state.filters.query;
  search.addEventListener("input", () => {
    remember({ filters: { ...state.filters, query: search.value } });
    drawBoard();
  });
  const { filters } = state;
  const priorities = PRIORITIES.map((priority) => [priority, priority === "none" ? "No priority" : titleCase(priority)] as const);
  const types = typesOf(context!.types, tasks).map((type) => [type.name, titleCase(type.name)] as const);
  bar.append(
    search,
    select("Assignee", filters.assignee, [[UNASSIGNED, "Unassigned"], ...pairs(peopleOf(tasks))], (assignee) => setFilter({ assignee })),
    select("Label", filters.label, pairs(labelsOf(tasks)), (label) => setFilter({ label })),
    select("Priority", filters.priority, priorities, (priority) => setFilter({ priority })),
    select("Type", filters.type, [["", "No type"], ...types], (type) => setFilter({ type })),
    select("Epic", filters.epic, [["", "No epic"], ...pairs(epicsOf(tasks))], (epic) => setFilter({ epic })),
  );
  if (Object.entries(filters).some(([key, value]) => (key === "query" ? value !== "" : value !== null))) {
    const clear = element("button", "gb-link", "Clear filters");
    clear.type = "button";
    clear.addEventListener("click", () => update({ filters: NO_FILTERS }));
    bar.append(clear);
  }
  const lanes = element("button", "gb-toggle", "Swimlanes");
  lanes.type = "button";
  lanes.title = "A swimlane per epic";
  lanes.setAttribute("aria-pressed", String(state.lanes));
  lanes.addEventListener("click", () => update({ lanes: !state.lanes }));
  bar.append(element("span", "gb-spacer"), lanes);
  return bar;
}

function card(task: Task, showEpic: boolean): HTMLElement {
  const item = element("div", "gb-card");
  item.draggable = true;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.dataset["path"] = task.path;
  const head = element("div", "gb-card-head");
  head.append(element("span", "gb-id", task.id));
  if (task.priority && task.priority !== "none")
    head.append(element("span", `gb-priority gb-priority-${task.priority}`, titleCase(task.priority)));
  if (task.assignee) head.append(avatar(task.assignee));
  item.append(head, element("div", "gb-card-title", task.title));
  if (task.type || task.labels.length || (showEpic && task.epic)) {
    const tags = element("div", "gb-labels");
    if (task.type) tags.append(typeChip(task.type, context!));
    if (showEpic && task.epic) tags.append(element("span", "gb-epic", task.epic));
    tags.append(...task.labels.map(labelChip));
    item.append(tags);
  }
  return item;
}

/** A drop target: a column, or a column within a swimlane. */
function cell(status: string, epic: string | null, cards: readonly Task[]): HTMLElement {
  const target = element("div", "gb-cell");
  target.dataset["status"] = status;
  if (epic !== null) target.dataset["epic"] = epic;
  target.setAttribute("aria-label", epic === null ? titleCase(status) : `${titleCase(status)}, ${epicName(epic)}`);
  target.append(...cards.map((task) => card(task, epic === null)));
  return target;
}

function drawBoard() {
  if (!context) return;
  const board = element("div", "gb-board");
  const visible = visibleTasks(tasks, state.filters);
  const columns = columnsOf(context.statuses, tasks).filter((status) => !context!.hiddenColumns.includes(status));
  board.style.setProperty("--columns", String(columns.length));
  for (const status of columns) {
    const head = element("div", "gb-column-head");
    const add = element("button", "gb-icon-button", "+");
    add.type = "button";
    add.title = `New task in ${titleCase(status)}`;
    add.setAttribute("aria-label", add.title);
    add.dataset["new"] = status;
    const count = element("span", "gb-count", String(visible.filter((task) => task.status === status).length));
    head.append(statusPill(status, context.statuses), count, element("span", "gb-spacer"), add);
    board.append(head);
  }
  if (!state.lanes) {
    for (const status of columns)
      board.append(
        cell(
          status,
          null,
          visible.filter((task) => task.status === status),
        ),
      );
  } else {
    for (const epic of shownLanesOf(visible, columns)) {
      const inLane = visible.filter((task) => task.epic === epic && columns.includes(task.status));
      const collapsed = state.collapsed.includes(epic);
      const head = element("button", "gb-lane-head");
      head.type = "button";
      head.dataset["lane"] = epic;
      head.setAttribute("aria-expanded", String(!collapsed));
      head.append(
        element("span", "gb-chevron", collapsed ? "▸" : "▾"),
        element("strong", "", epicName(epic)),
        element("span", "gb-count", String(inLane.length)),
      );
      board.append(head);
      if (!collapsed)
        for (const status of columns)
          board.append(
            cell(
              status,
              epic,
              inLane.filter((task) => task.status === status),
            ),
          );
    }
  }
  const old = root.querySelector(".gb-board");
  if (old) old.replaceWith(board);
  else root.append(board);
}

function draw() {
  if (!context) return;
  // The search field keeps its focus and caret while the board is drawn again.
  const search = root.querySelector<HTMLInputElement>(".gb-search");
  const focused = search !== null && document.activeElement === search;
  root.replaceChildren(toolbar());
  drawBoard();
  if (focused) {
    const fresh = root.querySelector<HTMLInputElement>(".gb-search")!;
    fresh.focus();
    fresh.setSelectionRange(fresh.value.length, fresh.value.length);
  }
}

function open(task: Task) {
  if (!context) return;
  shown = task.path;
  taskView.render(popupBody, task, context, context.version, { toolbar: false });
  document.getElementById("popup-id")!.textContent = task.id;
  if (!popup.open) popup.showModal();
}

function move(path: string, status: string, epic: string | undefined) {
  const task = tasks.find((candidate) => candidate.path === path);
  if (!task || (task.status === status && (epic === undefined || task.epic === epic))) return;
  // Moved right away; the extension's next board confirms it, or puts it back.
  tasks = tasks.map((candidate) => (candidate === task ? { ...task, status, epic: epic ?? task.epic } : candidate));
  drawBoard();
  bridge.post({ type: "move", paths: [path], status, ...(epic === undefined ? {} : { epic }) });
}

const cardTask = (event: Event) => {
  const item = (event.target as Element).closest<HTMLElement>(".gb-card");
  return item ? tasks.find((task) => task.path === item.dataset["path"]) : undefined;
};

root.addEventListener("click", (event) => {
  const target = event.target as Element;
  const add = target.closest<HTMLElement>("[data-new]");
  if (add) return bridge.post({ type: "newTask", status: add.dataset["new"]!, epic: state.filters.epic ?? "" });
  const lane = target.closest<HTMLElement>("[data-lane]");
  if (lane) {
    const epic = lane.dataset["lane"]!;
    const collapsed = state.collapsed.includes(epic) ? state.collapsed.filter((other) => other !== epic) : [...state.collapsed, epic];
    return update({ collapsed });
  }
  const task = cardTask(event);
  if (task) open(task);
});
root.addEventListener("keydown", (event) => {
  const task = cardTask(event);
  if (!task || (event.key !== "Enter" && event.key !== " ")) return;
  event.preventDefault();
  open(task);
});
root.addEventListener("dragstart", (event) => {
  const item = (event.target as Element).closest<HTMLElement>(".gb-card");
  if (!item || !event.dataTransfer) return;
  event.dataTransfer.setData(TASK_TYPE, item.dataset["path"]!);
  event.dataTransfer.effectAllowed = "move";
  item.classList.add("is-dragging");
});
root.addEventListener("dragend", (event) => (event.target as Element).closest(".gb-card")?.classList.remove("is-dragging"));
root.addEventListener("dragover", (event) => {
  const target = (event.target as Element).closest<HTMLElement>(".gb-cell");
  if (!target || !event.dataTransfer?.types.includes(TASK_TYPE)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  for (const other of root.querySelectorAll(".gb-cell.is-target")) if (other !== target) other.classList.remove("is-target");
  target.classList.add("is-target");
});
root.addEventListener("dragleave", (event) => {
  const target = (event.target as Element).closest<HTMLElement>(".gb-cell");
  if (target && !target.contains(event.relatedTarget as Node | null)) target.classList.remove("is-target");
});
root.addEventListener("drop", (event) => {
  const target = (event.target as Element).closest<HTMLElement>(".gb-cell");
  const path = event.dataTransfer?.getData(TASK_TYPE);
  target?.classList.remove("is-target");
  if (!target || !path) return;
  event.preventDefault();
  move(path, target.dataset["status"]!, target.dataset["epic"]);
});

popup.addEventListener("close", () => (shown = null));
// A click on the backdrop closes the popup.
popup.addEventListener("click", (event) => event.target === popup && popup.close());
document.getElementById("popup-close")!.addEventListener("click", () => popup.close());
document.getElementById("popup-edit")!.addEventListener("click", () => {
  if (shown) bridge.post({ type: "edit", area: "tasks", path: shown });
  popup.close();
});
document.getElementById("popup-preview")!.addEventListener("click", () => {
  if (shown) bridge.post({ type: "preview", area: "tasks", path: shown });
  popup.close();
});
document.getElementById("popup-delete")!.addEventListener("click", () => shown && bridge.post({ type: "delete", path: shown }));
