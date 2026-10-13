/**
 * Changing tasks with VS Code's own pickers and input boxes, as the app's
 * task panel does with its menus: from the trees' context menus and from
 * the previews and the board. Edits are queued, and each applies to the
 * newest version of the task.
 */
import * as vscode from "vscode";
import { epicsOf, inputOf, labelsOf, peopleOf, titleCase, typesOf } from "../../client/app/features/tasks/task-model";
import { PRIORITIES, type FieldValue, type Task, type TaskInput } from "../../contracts/model";
import type { Repository } from "./repository";
import type { PickedProperty } from "./webview/protocol";

interface Choice<T> extends vscode.QuickPickItem {
  readonly value: T;
}

const SOMEONE_ELSE = Symbol("someone else");
const NEW_EPIC = Symbol("new epic");

export class TaskActions {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly repository: () => Repository | undefined) {}

  private open(): Repository {
    const repository = this.repository();
    if (!repository) throw new Error("Open a folder with a Git repository first.");
    return repository;
  }

  /** The task at `path` in the newest snapshot. */
  private task(path: string): Task {
    const task = this.open().snapshot.tasks.find((candidate) => candidate.path === path);
    if (!task) throw new Error("This task no longer exists.");
    return task;
  }

  /** Runs edits one after another, so each sees the version the one before saved. */
  private queued<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Applies `change` to the newest version of the task; resolves to the task as saved. */
  update(path: string, change: (task: Task) => Partial<TaskInput>): Promise<Task> {
    return this.queued(async () => {
      const repository = this.open();
      await repository.refresh();
      const task = this.task(path);
      const saved = await repository.backend.content.updateTask(repository.id, path, { ...inputOf(task), ...change(task) }, task.hash);
      await repository.refresh();
      return saved;
    });
  }

  /** Moves tasks to a state, and into an epic if given; each is a separate edit, as on the board. */
  async move(paths: readonly string[], status: string, epic?: string): Promise<void> {
    for (const path of paths) await this.update(path, () => ({ status, ...(epic === undefined ? {} : { epic }) }));
  }

  /** Asks for a new value of a property with a quick pick, or an input box for the title; resolves to the task as saved. */
  async pick(path: string, property: PickedProperty): Promise<Task | undefined> {
    const task = this.task(path);
    const change = await this.ask(task, property);
    return change ? this.update(path, () => change) : undefined;
  }

  private async ask(task: Task, property: PickedProperty): Promise<Partial<TaskInput> | undefined> {
    const { settings, tasks } = this.open().snapshot;
    const title = `${task.id}: ${titleCase(property)}`;
    const choose = async <T>(choices: readonly Choice<T>[], current: T, placeHolder?: string) => {
      const items = choices.map((choice) => (choice.value === current ? { ...choice, description: "current" } : choice));
      return (await vscode.window.showQuickPick(items, { title, placeHolder }))?.value;
    };
    switch (property) {
      case "title": {
        const value = await vscode.window.showInputBox({ title, value: task.title, validateInput: required });
        return value?.trim() ? { title: value.trim() } : undefined;
      }
      case "status": {
        const status = await choose(
          settings.statuses.map((value) => ({ label: titleCase(value), value })),
          task.status,
        );
        return status === undefined ? undefined : { status };
      }
      case "type": {
        const types = [
          { label: "No type", value: "" },
          ...typesOf(settings.types, [task]).map((type) => ({ label: titleCase(type.name), value: type.name })),
        ];
        const type = await choose(types, task.type);
        return type === undefined ? undefined : { type };
      }
      case "priority": {
        const priorities = PRIORITIES.map((value) => ({ label: value === "none" ? "No priority" : titleCase(value), value }));
        const priority = await choose(priorities, task.priority || "none");
        return priority === undefined ? undefined : { priority };
      }
      case "assignee": {
        const people = await this.people();
        const choices: Choice<string | typeof SOMEONE_ELSE>[] = [
          { label: "$(person) Unassigned", value: "" },
          ...people,
          { label: "$(add) Someone else…", value: SOMEONE_ELSE },
        ];
        const assignee = await choose(choices, task.assignee);
        if (assignee !== SOMEONE_ELSE) return assignee === undefined ? undefined : { assignee };
        const name = await vscode.window.showInputBox({ title, prompt: "A handle, a name or an email", validateInput: required });
        return name?.trim() ? { assignee: name.trim() } : undefined;
      }
      case "epic": {
        const epics = [...new Set([...epicsOf(tasks), ...(task.epic ? [task.epic] : [])])].sort();
        const choices: Choice<string | typeof NEW_EPIC>[] = [
          { label: "$(folder) No epic", value: "" },
          ...epics.map((epic) => ({ label: `$(folder) ${epic}`, value: epic })),
          { label: "$(add) New epic…", value: NEW_EPIC },
        ];
        const epic = await choose(choices, task.epic);
        if (epic !== NEW_EPIC) return epic === undefined ? undefined : { epic };
        const name = await vscode.window.showInputBox({
          title,
          prompt: "The task moves into a folder of this name. Use / to nest epics.",
          placeHolder: "Login rework",
          validateInput: required,
        });
        return name?.trim() ? { epic: name.trim() } : undefined;
      }
      case "labels": {
        const labels = await pickLabels(title, [...new Set([...labelsOf(tasks), ...task.labels])].sort(), task.labels);
        return labels ? { labels } : undefined;
      }
    }
  }

  /** The repository's people by handle, then assignees who are none of them, as the app's assignee menu lists them. */
  private async people(): Promise<Choice<string>[]> {
    const repository = this.open();
    const known = await repository.backend.content
      .people(repository.id)
      .then((list) => list.people)
      .catch(() => []);
    const others = peopleOf(repository.snapshot.tasks).filter(
      (assignee) => !known.some((person) => person.handle === assignee || person.name === assignee || person.aliases.includes(assignee)),
    );
    return [
      ...known.map((person) => ({ label: `$(account) ${person.name}`, description: `@${person.handle}`, value: person.handle })),
      ...others.map((assignee) => ({ label: `$(account) ${assignee}`, value: assignee })),
    ];
  }

  setField(path: string, name: string, value: FieldValue): Promise<Task> {
    return this.update(path, (task) => ({ fields: { ...task.fields, [name]: value } }));
  }

  comment(path: string, text: string): Promise<unknown> {
    return this.queued(async () => {
      const repository = this.open();
      await repository.backend.content.addComment(repository.id, path, text);
      await repository.refresh();
    });
  }

  editComment(path: string, hash: string, index: number, text: string): Promise<unknown> {
    return this.queued(async () => {
      const repository = this.open();
      await repository.backend.content.editComment(repository.id, path, index, text, hash);
      await repository.refresh();
    });
  }

  async deleteComment(path: string, hash: string, index: number): Promise<void> {
    const answer = await vscode.window.showWarningMessage("Delete this comment?", { modal: true }, "Delete");
    if (answer !== "Delete") return;
    await this.queued(async () => {
      const repository = this.open();
      await repository.backend.content.deleteComment(repository.id, path, index, hash);
      await repository.refresh();
    });
  }

  /** Deletes a task after asking; resolves to whether it did. */
  async delete(path: string): Promise<boolean> {
    const task = this.task(path);
    const answer = await vscode.window.showWarningMessage(
      `Delete ${task.id} “${task.title}”?`,
      { modal: true, detail: "Git history keeps the file." },
      "Delete",
    );
    if (answer !== "Delete") return false;
    await this.queued(async () => {
      const repository = this.open();
      await repository.backend.content.deleteTask(repository.id, path);
      await repository.refresh();
    });
    return true;
  }

  /** Asks for a title and a type, and creates the task from the type's template; resolves to it, or undefined if cancelled. */
  async create(status?: string, epic = ""): Promise<Task | undefined> {
    const repository = this.open();
    const { settings } = repository.snapshot;
    const title = await vscode.window.showInputBox({ title: "New task", prompt: "Title", validateInput: required });
    if (!title?.trim()) return undefined;
    let type = "";
    if (settings.types.length) {
      const items = [{ label: "No type", value: "" }, ...settings.types.map((type) => ({ label: titleCase(type.name), value: type.name }))];
      const picked = await vscode.window.showQuickPick(items, { title: "New task: Type" });
      if (!picked) return undefined;
      type = picked.value;
    }
    const template = type ? await repository.backend.content.taskTemplate(repository.id, type) : null;
    const task = await repository.backend.content.createTask(repository.id, {
      title: title.trim(),
      status: status ?? settings.statuses[0]!,
      priority: template?.priority ?? "none",
      assignee: template?.assignee ?? "",
      labels: template?.labels ?? [],
      body: template?.body ?? "",
      epic,
      type,
      ...(template?.fields ? { fields: template.fields } : {}),
    });
    await repository.refresh();
    return task;
  }

  /** The task's activity, as JSON for a webview. */
  async activity(path: string): Promise<string> {
    const repository = this.open();
    return JSON.stringify(await repository.backend.content.taskActivity(repository.id, path));
  }
}

const required = (value: string) => (value.trim() ? undefined : "Enter a value.");

/** Labels to keep, with typed text offered as a new label. */
function pickLabels(title: string, labels: readonly string[], current: readonly string[]): Promise<string[] | undefined> {
  return new Promise((resolve) => {
    const pick = vscode.window.createQuickPick<vscode.QuickPickItem>();
    pick.title = title;
    pick.canSelectMany = true;
    pick.placeholder = "Choose labels, or type a new one";
    const existing = labels.map((label) => ({ label }));
    pick.items = existing;
    pick.selectedItems = existing.filter((item) => current.includes(item.label));
    pick.onDidChangeValue((value) => {
      const typed = value.trim();
      const fresh: vscode.QuickPickItem[] = typed && !labels.includes(typed) ? [{ label: typed, description: "New label" }] : [];
      const selected = pick.selectedItems;
      pick.items = [...fresh, ...existing];
      // A typed label is chosen right away: Enter adds it.
      pick.selectedItems = pick.items.filter((item) => fresh.includes(item) || selected.some((chosen) => chosen.label === item.label));
    });
    let done = false;
    pick.onDidAccept(() => {
      done = true;
      resolve(pick.selectedItems.map((item) => item.label));
      pick.hide();
    });
    pick.onDidHide(() => {
      if (!done) resolve(undefined);
      pick.dispose();
    });
    pick.show();
  });
}
