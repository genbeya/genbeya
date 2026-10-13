/**
 * The Tasks view: the tasks as a tree, one group per workflow state, or
 * grouped by epic first. Dragging tasks onto a state, an epic or a task moves
 * them there. A task opens in its preview; its Edit action opens the file.
 */
import * as vscode from "vscode";
import { epicName, lanesOf, titleCase } from "../../client/app/features/tasks/task-model";
import type { Task } from "../../contracts/model";
import type { Repository } from "./repository";
import { groupTasks, type TaskGroup } from "./task-groups";
import { PREVIEW_COMMAND } from "./wiki-view";

export type TaskElement =
  | { readonly kind: "epic"; readonly epic: string; readonly tasks: readonly Task[] }
  /** `epic` is the epic the group is in while the tree is grouped by epic, else null. */
  | { readonly kind: "group"; readonly group: TaskGroup; readonly epic: string | null }
  | { readonly kind: "task"; readonly task: Task; readonly epic: string | null };

/** Where dropped tasks go: a state, an epic, or both; undefined keeps what they have. */
export type Move = (paths: readonly string[], status: string | undefined, epic: string | undefined) => Promise<void>;

const MIME = "application/vnd.code.tree.genbeya.tasks";

/** Codicons for the default task types; other types get a plain one. */
const TYPE_ICONS: Readonly<Record<string, string>> = { bug: "bug", feature: "lightbulb", improvement: "arrow-up", chore: "tools" };

export class TasksView implements vscode.TreeDataProvider<TaskElement>, vscode.TreeDragAndDropController<TaskElement> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly dragMimeTypes = [MIME];
  readonly dropMimeTypes = [MIME];
  /** Epics first, then states within them. */
  byEpic = false;

  constructor(
    private readonly repository: () => Repository | undefined,
    private readonly move: Move,
  ) {}

  /** Redraws the tree, after the snapshot changed or the grouping did. */
  refresh() {
    this.changed.fire();
  }

  private groups(tasks?: readonly Task[]): TaskGroup[] {
    const snapshot = this.repository()?.snapshot;
    return snapshot ? groupTasks(tasks ?? snapshot.tasks, snapshot.settings) : [];
  }

  getChildren(element?: TaskElement): TaskElement[] {
    const tasks = this.repository()?.snapshot.tasks ?? [];
    if (!element) {
      if (!this.byEpic) return this.groups().map((group) => ({ kind: "group", group, epic: null }));
      return lanesOf(tasks).map((epic) => ({ kind: "epic", epic, tasks: tasks.filter((task) => task.epic === epic) }));
    }
    switch (element.kind) {
      case "epic":
        // Only the states that hold tasks of the epic; dropping onto the epic keeps a task's state.
        return this.groups(element.tasks)
          .filter((group) => group.tasks.length)
          .map((group) => ({ kind: "group", group, epic: element.epic }));
      case "group":
        return element.group.tasks.map((task) => ({ kind: "task", task, epic: element.epic }));
      case "task":
        return [];
    }
  }

  getTreeItem(element: TaskElement): vscode.TreeItem {
    if (element.kind === "epic") {
      const item = new vscode.TreeItem(epicName(element.epic), vscode.TreeItemCollapsibleState.Expanded);
      item.id = `epic:${element.epic}`;
      item.description = String(element.tasks.length);
      item.iconPath = new vscode.ThemeIcon(element.epic ? "folder" : "folder-opened");
      item.contextValue = "epic";
      return item;
    }
    if (element.kind === "group") {
      const { status, tasks, collapsed } = element.group;
      const item = new vscode.TreeItem(
        titleCase(status),
        collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `status:${element.epic ?? ""}:${status}`;
      item.description = String(tasks.length);
      item.contextValue = "status";
      return item;
    }
    const { task } = element;
    const item = new vscode.TreeItem(task.title, vscode.TreeItemCollapsibleState.None);
    item.id = `task:${task.path}`;
    // Grouped by epic, the epic is the task's folder above it.
    item.description = [task.id, task.assignee, element.epic === null && task.epic].filter(Boolean).join(" · ");
    item.iconPath = new vscode.ThemeIcon(TYPE_ICONS[task.type] ?? "circle-outline");
    item.contextValue = "task";
    item.tooltip = tooltip(task);
    const repository = this.repository();
    if (repository) {
      item.resourceUri = repository.uri("tasks", task.path);
      item.command = { command: PREVIEW_COMMAND, title: "Preview", arguments: [element] };
    }
    return item;
  }

  getParent(element: TaskElement): TaskElement | undefined {
    if (element.kind === "epic") return undefined;
    const tasks = this.repository()?.snapshot.tasks ?? [];
    if (element.kind === "group") {
      return element.epic === null
        ? undefined
        : { kind: "epic", epic: element.epic, tasks: tasks.filter((task) => task.epic === element.epic) };
    }
    const inEpic = element.epic === null ? undefined : tasks.filter((task) => task.epic === element.epic);
    const group = this.groups(inEpic).find((candidate) => candidate.status === element.task.status);
    return group && { kind: "group", group, epic: element.epic };
  }

  handleDrag(source: readonly TaskElement[], data: vscode.DataTransfer) {
    const tasks = source.flatMap((element) => (element.kind === "task" ? [element.task] : []));
    if (tasks.length) data.set(MIME, new vscode.DataTransferItem(tasks));
  }

  async handleDrop(target: TaskElement | undefined, data: vscode.DataTransfer) {
    const tasks = data.get(MIME)?.value as readonly Task[] | undefined;
    if (!target || !tasks) return;
    const status = target.kind === "epic" ? undefined : target.kind === "group" ? target.group.status : target.task.status;
    const epic = target.kind === "epic" ? target.epic : (target.epic ?? undefined);
    const moved = tasks.filter((task) => (status !== undefined && task.status !== status) || (epic !== undefined && task.epic !== epic));
    try {
      await this.move(
        moved.map((task) => task.path),
        status,
        epic,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

function tooltip(task: Task): vscode.MarkdownString {
  const facts = [
    task.type && `Type: ${titleCase(task.type)}`,
    task.priority && task.priority !== "none" && `Priority: ${titleCase(task.priority)}`,
    task.assignee && `Assignee: ${task.assignee}`,
    task.labels.length > 0 && `Labels: ${task.labels.join(", ")}`,
    task.epic && `Epic: ${task.epic}`,
  ].filter(Boolean);
  const text = new vscode.MarkdownString();
  text.appendMarkdown(`**${task.id}** `).appendText(task.title);
  if (facts.length) text.appendMarkdown("\n\n").appendText(facts.join("\n"));
  return text;
}
