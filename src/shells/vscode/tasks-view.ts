/**
 * The Tasks view: the board as a tree, one group per workflow state. Dragging
 * tasks onto another state, or onto a task in it, moves them there. A task
 * opens in the preview; its Edit action opens it in the editor.
 */
import * as vscode from "vscode";
import type { Task } from "../../contracts/model";
import type { Repository } from "./repository";
import { groupTasks, type TaskGroup } from "./task-groups";
import { PREVIEW_COMMAND } from "./wiki-view";

export type TaskElement = { readonly kind: "group"; readonly group: TaskGroup } | { readonly kind: "task"; readonly task: Task };

const MIME = "application/vnd.code.tree.genbeya.tasks";

/** Codicons for the default task types; other types get a plain one. */
const TYPE_ICONS: Readonly<Record<string, string>> = { bug: "bug", feature: "lightbulb", improvement: "arrow-up", chore: "tools" };

export class TasksView implements vscode.TreeDataProvider<TaskElement>, vscode.TreeDragAndDropController<TaskElement> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  readonly dragMimeTypes = [MIME];
  readonly dropMimeTypes = [MIME];

  constructor(
    private readonly repository: () => Repository | undefined,
    /** Moves tasks to another workflow state, each a separate edit, as on the board. */
    private readonly move: (paths: readonly string[], status: string) => Promise<void>,
  ) {}

  /** Redraws the tree, after the snapshot changed. */
  refresh() {
    this.changed.fire();
  }

  private groups(): TaskGroup[] {
    const snapshot = this.repository()?.snapshot;
    return snapshot ? groupTasks(snapshot.tasks, snapshot.settings) : [];
  }

  getChildren(element?: TaskElement): TaskElement[] {
    if (!element) return this.groups().map((group) => ({ kind: "group", group }));
    return element.kind === "group" ? element.group.tasks.map((task) => ({ kind: "task", task })) : [];
  }

  getTreeItem(element: TaskElement): vscode.TreeItem {
    if (element.kind === "group") {
      const { status, tasks, collapsed } = element.group;
      const item = new vscode.TreeItem(
        status,
        collapsed ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.Expanded,
      );
      item.id = `status:${status}`;
      item.description = String(tasks.length);
      item.contextValue = "status";
      return item;
    }
    const { task } = element;
    const item = new vscode.TreeItem(task.title, vscode.TreeItemCollapsibleState.None);
    item.id = `task:${task.path}`;
    item.description = [task.id, task.assignee, task.epic].filter(Boolean).join(" · ");
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
    if (element.kind === "group") return undefined;
    const group = this.groups().find((candidate) => candidate.status === element.task.status);
    return group && { kind: "group", group };
  }

  handleDrag(source: readonly TaskElement[], data: vscode.DataTransfer) {
    const tasks = source.flatMap((element) => (element.kind === "task" ? [element.task] : []));
    if (tasks.length) data.set(MIME, new vscode.DataTransferItem(tasks));
  }

  async handleDrop(target: TaskElement | undefined, data: vscode.DataTransfer) {
    const tasks = data.get(MIME)?.value as readonly Task[] | undefined;
    if (!target || !tasks) return;
    const status = target.kind === "group" ? target.group.status : target.task.status;
    try {
      await this.move(
        tasks.filter((task) => task.status !== status).map((task) => task.path),
        status,
      );
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }
}

function tooltip(task: Task): vscode.MarkdownString {
  const facts = [
    task.type && `Type: ${task.type}`,
    task.priority && `Priority: ${task.priority}`,
    task.assignee && `Assignee: ${task.assignee}`,
    task.labels.length > 0 && `Labels: ${task.labels.join(", ")}`,
    task.epic && `Epic: ${task.epic}`,
  ].filter(Boolean);
  const text = new vscode.MarkdownString();
  text.appendMarkdown(`**${task.id}** `).appendText(task.title);
  if (facts.length) text.appendMarkdown("\n\n").appendText(facts.join("\n"));
  return text;
}
