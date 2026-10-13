/**
 * The VS Code shell: the managers run in the extension host, on the machine
 * the workspace lives on (local, WSL, SSH or a container, by VS Code's remote
 * support). Native views list the repository's pages and tasks; pages and
 * tasks open in a preview rendered as the app renders them, or in VS Code's
 * editor to edit them. The board is a webview of its own.
 */
import * as vscode from "vscode";
import type { Snapshot, WikiNode } from "../../contracts/model";
import { createBackend, type Backend } from "../../managers/backend";
import { nodeMachine } from "../../platforms/node/node-machine";
import { CONTENT_SCHEME, ContentFiles } from "./content-files";
import { Repository } from "./repository";
import { TasksView, type TaskElement } from "./tasks-view";
import { Webviews, type Target } from "./webviews";
import { PREVIEW_COMMAND, WikiView } from "./wiki-view";

/** The `genbeya.state` context key, which picks the views' welcome text. */
type State = "opening" | "open" | "none" | "failed";

/** What the extension offers other extensions, and its tests. */
export interface GenbeyaApi {
  /** The open repository's snapshot; null while none is open. */
  snapshot(): Snapshot | null;
  /** Takes a new snapshot if anything changed. */
  refresh(): Promise<void>;
}

let backend: Backend | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<GenbeyaApi> {
  let repository: Repository | undefined;
  const current = () => repository;
  const files = new ContentFiles(current);
  const wiki = new WikiView(current);
  const tasks = new TasksView(current);
  const wikiTree = vscode.window.createTreeView("genbeya.wiki", { treeDataProvider: wiki, showCollapseAll: true });
  const tasksTree = vscode.window.createTreeView("genbeya.tasks", {
    treeDataProvider: tasks,
    dragAndDropController: tasks,
    canSelectMany: true,
  });
  const setState = (state: State, message?: string) => {
    void vscode.commands.executeCommand("setContext", "genbeya.state", state);
    wikiTree.message = tasksTree.message = message;
  };
  const edit = async (target: Target) => {
    if (repository) await vscode.window.showTextDocument(repository.uri(target.area, target.path));
  };
  const webviews = new Webviews(context.extensionUri, { repository: current, edit, move: (moved, status) => tasks.move(moved, status) });
  const redraw = () => {
    wiki.refresh();
    tasks.refresh();
    void files.checkOpenDocuments();
    void webviews.refresh();
  };

  backend = await createBackend(nodeMachine(), context.globalStorageUri.fsPath);
  const managers = backend;

  /** Shows the first workspace folder that holds a Git repository. */
  const open = async () => {
    repository?.dispose();
    repository = undefined;
    redraw();
    const folders = (vscode.workspace.workspaceFolders ?? []).filter((folder) => folder.uri.scheme === "file");
    if (!folders.length) return setState("none");
    setState("opening");
    let failure = "";
    for (const folder of folders) {
      try {
        repository = await Repository.open(managers, folder.uri);
        break;
      } catch (error) {
        failure ||= error instanceof Error ? error.message : String(error);
      }
    }
    if (!repository) return setState("failed", failure);
    repository.onDidChange(redraw);
    setState("open");
    redraw();
  };

  /** Runs a command on the open repository, reporting what fails. */
  const withRepository =
    <A extends unknown[]>(run: (repository: Repository, ...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      if (!repository) return void vscode.window.showWarningMessage("Open a folder with a Git repository first.");
      try {
        await run(repository, ...args);
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    };

  context.subscriptions.push(
    wikiTree,
    tasksTree,
    vscode.workspace.registerFileSystemProvider(CONTENT_SCHEME, files, { isCaseSensitive: true }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void open()),
    webviews,
    vscode.commands.registerCommand(
      PREVIEW_COMMAND,
      withRepository(async (_, item?: Item) => {
        const target = targetOf(item);
        if (target) await webviews.showPreview(target);
      }),
    ),
    vscode.commands.registerCommand(
      "genbeya.edit",
      withRepository(async (_, item?: Item) => {
        const target = targetOf(item) ?? webviews.activePreview;
        if (target) await edit(target);
      }),
    ),
    vscode.commands.registerCommand(
      "genbeya.openBoard",
      withRepository(async () => webviews.showBoard()),
    ),
    vscode.commands.registerCommand(
      "genbeya.refresh",
      withRepository((repository) => repository.refresh()),
    ),
    vscode.commands.registerCommand(
      "genbeya.newTask",
      withRepository(async (repository) => {
        const title = await vscode.window.showInputBox({ title: "New task", prompt: "Title", validateInput: required });
        if (!title) return;
        const { statuses } = repository.snapshot.settings;
        const task = await managers.content.createTask(repository.id, {
          title: title.trim(),
          status: statuses[0]!,
          priority: "",
          assignee: "",
          labels: [],
          body: "",
          epic: "",
        });
        await repository.refresh();
        await edit({ area: "tasks", path: task.path });
      }),
    ),
    vscode.commands.registerCommand(
      "genbeya.newPage",
      withRepository(async (repository) => {
        const name = await vscode.window.showInputBox({
          title: "New page",
          prompt: "Name, with folders for a subpage (Guide/Setup)",
          validateInput: required,
        });
        if (!name) return;
        const page = await managers.content.createPage(repository.id, `${repository.snapshot.settings.wikiRoot}/${name.trim()}.md`);
        await repository.refresh();
        await edit({ area: "wiki", path: page.path });
      }),
    ),
    vscode.commands.registerCommand(
      "genbeya.setStatus",
      withRepository(async (repository, element?: TaskElement, selected?: readonly TaskElement[]) => {
        const chosen = (selected?.length ? selected : element ? [element] : tasksTree.selection).flatMap((item) =>
          item.kind === "task" ? [item.task] : [],
        );
        if (!chosen.length) return;
        const status = await vscode.window.showQuickPick([...repository.snapshot.settings.statuses], {
          title: chosen.length === 1 ? `Move ${chosen[0]!.id} to` : `Move ${chosen.length} tasks to`,
        });
        if (status) await tasks.move(chosen, status);
      }),
    ),
    { dispose: () => repository?.dispose() },
  );

  await open();
  return {
    snapshot: () => repository?.snapshot ?? null,
    refresh: async () => repository?.refresh(),
  };
}

export async function deactivate(): Promise<void> {
  await backend?.dispose();
  backend = undefined;
}

const required = (value: string) => (value.trim() ? undefined : "Enter a name.");

/** What commands on pages and tasks get: a tree item, or a page or task named directly. */
type Item = WikiNode | TaskElement | Target;

function targetOf(item: Item | undefined): Target | null {
  if (!item) return null;
  if ("area" in item) return item;
  if ("kind" in item) return item.kind === "task" ? { area: "tasks", path: item.task.path } : null;
  return item.path ? { area: "wiki", path: item.path } : null;
}
