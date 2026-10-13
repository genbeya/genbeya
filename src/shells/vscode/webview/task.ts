/** A task rendered for reading: its properties, its description and its comments. */
import { initials, avatarHue } from "../../../client/app/ui/avatar-hue";
import { statusTone } from "../../../client/app/ui/status-tone";
import type { Task } from "../../../contracts/model";
import type { MarkdownRenderer } from "./markdown";
import type { MarkdownContext } from "./protocol";

/** "in-progress" → "In progress", as the app names states. */
export const stateName = (status: string): string => status.replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] => {
  const created = document.createElement(tag);
  if (className) created.className = className;
  if (text !== undefined) created.textContent = text;
  return created;
};

/** A workflow state as a coloured pill. */
export function statusPill(status: string, statuses: readonly string[]): HTMLElement {
  return element("span", `gb-status tone-${statusTone(statuses.indexOf(status), statuses.length)}`, stateName(status));
}

/** A person's initials on their colour. */
export function avatar(name: string): HTMLElement {
  const badge = element("span", "gb-avatar", initials(name));
  badge.style.background = `var(--avatar-${avatarHue(name)})`;
  badge.title = name;
  return badge;
}

const formatDate = (iso: string): string => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};

export function renderTask(host: HTMLElement, task: Task, context: MarkdownContext, markdown: MarkdownRenderer): void {
  const header = element("header", "gb-task-header");
  const line = element("div", "gb-task-line");
  line.append(element("span", "gb-id", task.id), statusPill(task.status, context.statuses));
  if (task.type) line.append(element("span", "gb-chip", task.type));
  if (task.priority) line.append(element("span", `gb-chip gb-priority-${task.priority}`, task.priority));
  header.append(line, element("h1", "gb-task-title", task.title));

  const properties = element("dl", "gb-properties");
  const property = (name: string, value: Node | string) => {
    const definition = element("dd");
    definition.append(value);
    properties.append(element("dt", "", name), definition);
  };
  if (task.assignee) {
    const person = element("span", "gb-person");
    person.append(avatar(task.assignee), document.createTextNode(task.assignee));
    property("Assignee", person);
  }
  if (task.labels.length) {
    const labels = element("span", "gb-labels");
    labels.append(...task.labels.map((label) => element("span", "gb-label", label)));
    property("Labels", labels);
  }
  if (task.epic) property("Epic", task.epic);
  for (const [name, value] of Object.entries(task.fields)) property(name, String(value));
  if (properties.childElementCount) header.append(properties);

  const body = element("div");
  if (task.body.trim()) markdown.render(body, task.body, { path: task.path, area: "tasks", checkboxes: true }, context);
  else body.append(element("p", "gb-empty", "No description."));

  host.replaceChildren(header, body);
  if (!task.comments.length) return;
  const comments = element("section", "gb-comments");
  comments.append(element("h2", "", `Comments (${task.comments.length})`));
  for (const comment of task.comments) {
    const item = element("article", "gb-comment");
    const head = element("div", "gb-comment-head");
    const author = element("strong", "", comment.author);
    const date = element("time", "", formatDate(comment.date));
    date.dateTime = comment.date;
    head.append(avatar(comment.author), author, date);
    const text = element("div");
    markdown.render(text, comment.body, { path: task.path, area: "tasks", checkboxes: false }, context);
    item.append(head, text);
    comments.append(item);
  }
  host.append(comments);
}
