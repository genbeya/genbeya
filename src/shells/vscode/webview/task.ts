/**
 * A task, as the app's task panel shows it: its properties, which open VS
 * Code's pickers, its custom fields, its description, its comments (the
 * user's own can be edited) and its activity. Changes go to the extension.
 */
import { describeChange } from "../../../client/app/features/tasks/task-changes";
import { epicName, labelColor, titleCase, toneColor, typeLook } from "../../../client/app/features/tasks/task-model";
import { initials, avatarHue } from "../../../client/app/ui/avatar-hue";
import { relativeTime } from "../../../client/app/ui/relative-time";
import { statusTone } from "../../../client/app/ui/status-tone";
import type { FieldDefinition, FieldValue, Task, TaskActivity } from "../../../contracts/model";
import type { Bridge } from "./bridge";
import type { MarkdownRenderer } from "./markdown";
import type { MarkdownContext, PickedProperty } from "./protocol";

/** "in-progress" → "In progress", as the app names states. */
export const stateName = titleCase;

export const element = <K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text?: string): HTMLElementTagNameMap[K] => {
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

/** A task type in its colour. */
export function typeChip(type: string, context: MarkdownContext): HTMLElement {
  const chip = element("span", "gb-type", titleCase(type));
  chip.style.setProperty("--type", toneColor(typeLook(type, context.types).tone));
  return chip;
}

/** A label in the colour the app gives it. */
export function labelChip(label: string): HTMLElement {
  const chip = element("span", "gb-label", label);
  chip.style.setProperty("--label", labelColor(label));
  return chip;
}

const localTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export interface TaskViewOptions {
  /** Edit and Delete above the task; the board's popup has its own bar. */
  readonly toolbar: boolean;
}

interface Shown {
  readonly key: string;
  readonly task: Task;
  /** Renders the task again, as it is. */
  readonly again: () => void;
}

/** Shows tasks in hosts and handles what is done there. */
export class TaskView {
  private readonly shown = new WeakMap<HTMLElement, Shown>();
  private readonly listening = new WeakSet<HTMLElement>();

  constructor(
    private readonly bridge: Bridge,
    private readonly markdown: MarkdownRenderer,
  ) {}

  /**
   * Renders `task` into `host`. A comment being written or edited, and an
   * open activity list, survive the new version of the task.
   */
  render(host: HTMLElement, task: Task, context: MarkdownContext, version: string, options: TaskViewOptions): void {
    // The whole task: while its file is edited, the preview shows the unsaved text under the saved hash.
    const key = `${version}:${JSON.stringify(task)}`;
    if (this.shown.get(host)?.key === key) return;
    this.listen(host);
    const draft = host.querySelector<HTMLTextAreaElement>(".gb-composer")?.value ?? "";
    const editor = host.querySelector<HTMLTextAreaElement>(".gb-comment-editor");
    const editing =
      editor && this.shown.get(host)?.task.path === task.path ? { index: Number(editor.dataset["index"]), text: editor.value } : null;
    const activityOpen = host.querySelector<HTMLDetailsElement>(".gb-activity")?.open ?? false;
    this.shown.set(host, { key, task, again: () => this.render(host, task, context, version, options) });

    const parts: Node[] = [];
    if (options.toolbar) {
      const bar = element("div", "gb-toolbar");
      bar.append(
        element("span", "gb-id", task.id),
        element("span", "gb-spacer"),
        button("Edit File", "edit", "is-primary"),
        button("Delete", "delete"),
      );
      parts.push(bar);
    }
    const title = button(task.title, "title", "gb-title");
    title.title = "Rename";
    const heading = element("h1", "gb-task-title");
    heading.append(title);
    parts.push(heading, this.properties(task, context), ...this.fields(task, context.fields));

    const body = element("div", "gb-body");
    if (task.body.trim()) this.markdown.render(body, task.body, { path: task.path, area: "tasks", checkboxes: true }, context);
    else body.append(element("p", "gb-empty", "No description. Edit the file to add one."));
    parts.push(body, this.comments(task, context, draft, editing));

    const activity = element("details", "gb-activity");
    activity.append(element("summary", "", "Activity"), element("div", "gb-activity-list"));
    parts.push(activity);
    host.replaceChildren(...parts);
    if (activityOpen) {
      activity.open = true;
      void this.loadActivity(host, task);
    }
  }

  private properties(task: Task, context: MarkdownContext): HTMLElement {
    const row = element("div", "gb-property-row");
    const property = (name: PickedProperty, label: string, ...content: (Node | string)[]) => {
      const chip = button("", `pick:${name}`, "gb-property");
      chip.setAttribute("aria-label", `${label}: ${chip.textContent}`);
      chip.title = `Change ${label.toLowerCase()}`;
      chip.replaceChildren(...content);
      row.append(chip);
    };
    property("status", "Status", statusPill(task.status, context.statuses));
    property("type", "Type", task.type ? typeChip(task.type, context) : element("span", "gb-faint", "No type"));
    property(
      "priority",
      "Priority",
      element(
        "span",
        task.priority && task.priority !== "none" ? `gb-priority-${task.priority}` : "gb-faint",
        task.priority && task.priority !== "none" ? titleCase(task.priority) : "No priority",
      ),
    );
    property(
      "assignee",
      "Assignee",
      ...(task.assignee ? [avatar(task.assignee), task.assignee] : [element("span", "gb-faint", "Unassigned")]),
    );
    property("epic", "Epic", element("span", task.epic ? "" : "gb-faint", epicName(task.epic)));
    property("labels", "Labels", ...(task.labels.length ? task.labels.map(labelChip) : [element("span", "gb-faint", "Labels")]));
    return row;
  }

  /** An input per configured field; the task's other fields are shown as they are. */
  private fields(task: Task, definitions: readonly FieldDefinition[]): HTMLElement[] {
    const others = Object.entries(task.fields).filter(([name]) => !definitions.some((field) => field.name === name));
    if (!definitions.length && !others.length) return [];
    const grid = element("div", "gb-fields");
    for (const field of definitions) {
      const id = `field-${field.name}`;
      const label = element("label", "", titleCase(field.name));
      label.htmlFor = id;
      const current = String(task.fields[field.name] ?? "");
      let input: HTMLInputElement | HTMLSelectElement;
      if (field.type === "choice") {
        input = element("select");
        const options = [...new Set(["", ...(field.options ?? []), current])];
        input.append(
          ...options.map((option) => Object.assign(element("option", "", option || "—"), { value: option, selected: option === current })),
        );
      } else {
        input = element("input");
        input.type = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
        input.value = current;
      }
      input.id = id;
      input.dataset["field"] = field.name;
      input.dataset["kind"] = field.type;
      grid.append(label, input);
    }
    for (const [name, value] of others) {
      const label = element("span", "", name);
      label.title = "Add this field in the settings to edit it here.";
      grid.append(label, element("span", "gb-field-value", String(value)));
    }
    return [grid];
  }

  private comments(task: Task, context: MarkdownContext, draft: string, editing: { index: number; text: string } | null): HTMLElement {
    const section = element("section", "gb-comments");
    section.append(element("h2", "", task.comments.length ? `Comments (${task.comments.length})` : "Comments"));
    task.comments.forEach((comment, index) => {
      const item = element("article", "gb-comment");
      item.setAttribute("aria-label", `Comment by ${comment.author}`);
      const head = element("div", "gb-comment-head");
      const date = element("time", "", relativeTime(comment.date));
      date.dateTime = comment.date;
      date.title = localTime(comment.date);
      head.append(avatar(comment.author), element("strong", "", comment.author), date);
      const text = element("div");
      if (comment.author === context.author) {
        head.append(element("span", "gb-spacer"));
        if (editing?.index !== index)
          head.append(button("Edit", `edit-comment:${index}`, "gb-link"), button("Delete", `delete-comment:${index}`, "gb-link"));
      }
      if (editing?.index === index) text.append(...commentEditor(index, editing.text));
      else this.markdown.render(text, comment.body, { path: task.path, area: "tasks", checkboxes: false }, context);
      item.append(head, text);
      section.append(item);
    });
    const composer = element("textarea", "gb-composer");
    composer.placeholder = "Add a comment… Markdown, [[references]], @mentions and //dates work. Ctrl+Enter sends.";
    composer.setAttribute("aria-label", "New comment");
    composer.rows = 3;
    composer.value = draft;
    const actions = element("div", "gb-composer-actions");
    actions.append(button("Comment", "comment", "is-primary"));
    section.append(composer, actions);
    return section;
  }

  private listen(host: HTMLElement) {
    if (this.listening.has(host)) return;
    this.listening.add(host);
    const task = () => this.shown.get(host)!.task;
    host.addEventListener("click", (event) => {
      const action = (event.target as Element).closest<HTMLElement>("[data-action]")?.dataset["action"];
      if (!action) return;
      const [name, argument = ""] = action.split(":");
      const { path, hash } = task();
      switch (name) {
        case "pick":
          return this.bridge.post({ type: "pick", path, property: argument as PickedProperty });
        case "title":
          return this.bridge.post({ type: "pick", path, property: "title" });
        case "edit":
          return this.bridge.post({ type: "edit", area: "tasks", path });
        case "delete":
          return this.bridge.post({ type: "delete", path });
        case "comment":
          return this.sendComment(host);
        case "edit-comment": {
          const index = Number(argument);
          const body = host.querySelectorAll(".gb-comment")[index]?.lastElementChild;
          body?.replaceChildren(...commentEditor(index, task().comments[index]?.body ?? ""));
          body?.querySelector("textarea")?.focus();
          return;
        }
        case "save-comment": {
          const editor = host.querySelector<HTMLTextAreaElement>(".gb-comment-editor");
          if (!editor?.value.trim()) return;
          this.bridge.post({ type: "editComment", path, hash, index: Number(argument), text: editor.value });
          // The saved comment comes back with the task's next version.
          editor.parentElement!.replaceChildren(element("p", "gb-faint", "Saving…"));
          return;
        }
        case "cancel-comment": {
          const { again } = this.shown.get(host)!;
          host.querySelector(".gb-comment-editor")?.remove();
          this.shown.delete(host);
          return again();
        }
        case "delete-comment":
          return this.bridge.post({ type: "deleteComment", path, hash, index: Number(argument) });
      }
    });
    host.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement;
      if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey)) return;
      if (target.classList.contains("gb-composer")) {
        event.preventDefault();
        this.sendComment(host);
      } else if (target.classList.contains("gb-comment-editor")) {
        event.preventDefault();
        target.parentElement?.querySelector<HTMLButtonElement>("[data-action^='save-comment']")?.click();
      }
    });
    host.addEventListener("change", (event) => {
      const input = event.target as HTMLInputElement | HTMLSelectElement;
      const name = input.dataset["field"];
      if (!name) return;
      let value: FieldValue = input.value;
      if (input.dataset["kind"] === "number" && value !== "") {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        value = number;
      }
      this.bridge.post({ type: "field", path: task().path, name, value });
    });
    host.addEventListener(
      "toggle",
      (event) => {
        const details = event.target as HTMLDetailsElement;
        if (details.classList.contains("gb-activity") && details.open) void this.loadActivity(host, task());
      },
      true,
    );
  }

  private sendComment(host: HTMLElement) {
    const composer = host.querySelector<HTMLTextAreaElement>(".gb-composer");
    if (!composer?.value.trim()) return;
    this.bridge.post({ type: "comment", path: this.shown.get(host)!.task.path, text: composer.value });
    composer.value = "";
  }

  private async loadActivity(host: HTMLElement, task: Task) {
    const list = host.querySelector(".gb-activity-list");
    if (!list) return;
    list.replaceChildren(element("p", "gb-faint", "Loading…"));
    let entries: TaskActivity[];
    try {
      entries = JSON.parse(await this.bridge.request({ type: "activity", path: task.path })) as TaskActivity[];
    } catch (error) {
      list.replaceChildren(element("p", "gb-faint", error instanceof Error ? error.message : String(error)));
      return;
    }
    if (this.shown.get(host)?.task.path !== task.path) return;
    if (!entries.length) return list.replaceChildren(element("p", "gb-faint", "No history yet."));
    list.replaceChildren(
      ...entries.map((entry) => {
        const item = element("div", "gb-activity-entry");
        const head = element("div", "gb-comment-head");
        head.append(avatar(entry.author), element("strong", "", entry.author));
        const when = element("time", "", entry.date ? relativeTime(entry.date) : "Not committed yet");
        if (entry.date) when.title = localTime(entry.date);
        head.append(when);
        const changes = element("ul");
        changes.append(...entry.changes.map((change) => element("li", "", describeChange(change))));
        item.append(head, changes);
        return item;
      }),
    );
  }
}

function button(text: string, action: string, className = ""): HTMLButtonElement {
  const created = element("button", className, text);
  created.type = "button";
  created.dataset["action"] = action;
  return created;
}

function commentEditor(index: number, text: string): Node[] {
  const editor = element("textarea", "gb-comment-editor");
  editor.dataset["index"] = String(index);
  editor.setAttribute("aria-label", "Comment");
  editor.rows = 4;
  editor.value = text;
  const actions = element("div", "gb-composer-actions");
  actions.append(button("Cancel", "cancel-comment"), button("Save", `save-comment:${index}`, "is-primary"));
  return [editor, actions];
}
