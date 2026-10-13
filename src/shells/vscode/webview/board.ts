/**
 * The board webview: one column per workflow state. Cards drag between
 * columns; a click opens the task's preview in a popup, from where it can
 * be edited or moved.
 */
import "./theme";
import type { Task } from "../../../contracts/model";
import { Bridge } from "./bridge";
import { MarkdownRenderer } from "./markdown";
import type { BoardColumn, MarkdownContext } from "./protocol";
import { avatar, renderTask, stateName, statusPill } from "./task";

const TASK_TYPE = "application/x-genbeya-task";

const root = document.getElementById("root")!;
const popup = document.getElementById("popup") as HTMLDialogElement;
const popupBody = document.getElementById("popup-body")!;
const popupStatus = document.getElementById("popup-status") as HTMLSelectElement;

let columns: readonly BoardColumn[] = [];
let context: MarkdownContext | null = null;
/** The task the popup shows, by path. */
let shown: string | null = null;

const bridge = new Bridge((message) => {
  if (message.type !== "board") return;
  ({ columns, context } = message);
  draw();
  if (!shown) return;
  const task = find(shown);
  if (task) open(task);
  else popup.close();
});
const markdown = new MarkdownRenderer(bridge);
markdown.listen(popupBody);

const find = (path: string): Task | undefined => columns.flatMap((column) => column.tasks).find((task) => task.path === path);

const span = (className: string, text: string) => {
  const element = document.createElement("span");
  element.className = className;
  element.textContent = text;
  return element;
};

function card(task: Task): HTMLElement {
  const item = document.createElement("div");
  item.className = "gb-card";
  item.draggable = true;
  item.tabIndex = 0;
  item.setAttribute("role", "button");
  item.dataset["path"] = task.path;
  const head = document.createElement("div");
  head.className = "gb-card-head";
  head.append(span("gb-id", task.id));
  if (task.priority) head.append(span(`gb-chip gb-priority-${task.priority}`, task.priority));
  if (task.assignee) head.append(avatar(task.assignee));
  const title = document.createElement("div");
  title.className = "gb-card-title";
  title.textContent = task.title;
  item.append(head, title);
  if (task.type || task.labels.length) {
    const labels = document.createElement("div");
    labels.className = "gb-labels";
    if (task.type) labels.append(span("gb-chip", task.type));
    labels.append(...task.labels.map((label) => span("gb-label", label)));
    item.append(labels);
  }
  return item;
}

function draw() {
  const board = document.createElement("div");
  board.className = "gb-board";
  for (const column of columns) {
    const lane = document.createElement("section");
    lane.className = "gb-column";
    lane.dataset["status"] = column.status;
    lane.setAttribute("aria-label", stateName(column.status));
    const head = document.createElement("header");
    head.append(statusPill(column.status, context?.statuses ?? []), span("gb-count", String(column.tasks.length)));
    const cards = document.createElement("div");
    cards.className = "gb-cards";
    cards.append(...column.tasks.map(card));
    lane.append(head, cards);
    board.append(lane);
  }
  root.replaceChildren(board);
}

function open(task: Task) {
  if (!context) return;
  shown = task.path;
  renderTask(popupBody, task, context, markdown);
  popupStatus.replaceChildren(
    ...context.statuses.map((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = stateName(status);
      option.selected = status === task.status;
      return option;
    }),
  );
  if (!popup.open) popup.showModal();
}

function move(paths: readonly string[], status: string) {
  // Moved right away; the extension's next board confirms it, or puts it back.
  const moved = new Set(paths);
  const tasks = columns.flatMap((column) => column.tasks.filter((task) => moved.has(task.path) && task.status !== status));
  if (!tasks.length) return;
  columns = columns.map((column) => ({
    status: column.status,
    tasks:
      column.status === status
        ? [...column.tasks, ...tasks.map((task) => ({ ...task, status }))]
        : column.tasks.filter((task) => !tasks.includes(task)),
  }));
  draw();
  bridge.post({ type: "move", paths: tasks.map((task) => task.path), status });
}

const cardTask = (event: Event) => {
  const item = (event.target as Element).closest<HTMLElement>(".gb-card");
  return item ? find(item.dataset["path"]!) : undefined;
};

root.addEventListener("click", (event) => {
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
  const lane = (event.target as Element).closest<HTMLElement>(".gb-column");
  if (!lane || !event.dataTransfer?.types.includes(TASK_TYPE)) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
  for (const other of root.querySelectorAll(".gb-column.is-target")) if (other !== lane) other.classList.remove("is-target");
  lane.classList.add("is-target");
});
root.addEventListener("dragleave", (event) => {
  const lane = (event.target as Element).closest<HTMLElement>(".gb-column");
  if (lane && !lane.contains(event.relatedTarget as Node | null)) lane.classList.remove("is-target");
});
root.addEventListener("drop", (event) => {
  const lane = (event.target as Element).closest<HTMLElement>(".gb-column");
  const path = event.dataTransfer?.getData(TASK_TYPE);
  lane?.classList.remove("is-target");
  if (!lane || !path) return;
  event.preventDefault();
  move([path], lane.dataset["status"]!);
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
popupStatus.addEventListener("change", () => shown && move([shown], popupStatus.value));
