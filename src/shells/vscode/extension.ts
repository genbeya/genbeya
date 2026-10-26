/**
 * The VS Code shell: the managers run in the extension host, on the machine
 * the workspace lives on (local, WSL, SSH or a container, by VS Code's remote
 * support). Native views list the repository's pages and tasks; pages and
 * tasks open in a preview tab rendered as the app renders them, or in VS
 * Code's editor to edit them. The board is a webview of its own.
 */
import * as vscode from "vscode";
import { pageName, pagePath, pageNameProblem } from "../../client/app/features/wiki/wiki-pages";
import { syncsContentBranch, type Snapshot, type WikiNode } from "../../contracts/model";
import { createBackend, type Backend } from "../../managers/backend";
import { nodeMachine } from "../../platforms/node/node-machine";
import { CONTENT_SCHEME, ContentFiles } from "./content-files";
import { REVISION_SCHEME, RevisionFiles } from "./revision-files";
import { MarkdownLanguage } from "./markdown-language";
import { Repository } from "./repository";
import { TaskActions } from "./task-actions";
import { TasksView, type TaskElement } from "./tasks-view";
import type { PickedProperty } from "./webview/protocol";
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

/** Commands that change one property of the tasks chosen in the Tasks view. */
const PROPERTY_COMMANDS: Readonly<Record<string, PickedProperty>> = {
  "genbeya.setStatus": "status",
  "genbeya.setType": "type",
  "genbeya.setPriority": "priority",
  "genbeya.setAssignee": "assignee",
  "genbeya.setEpic": "epic",
  "genbeya.setLabels": "labels",
  "genbeya.renameTask": "title",
};

let backend: Backend | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<GenbeyaApi> {
  let repository: Repository | undefined;
  const current = () => repository;
  const files = new ContentFiles(current);
  const actions = new TaskActions(current);
  const wiki = new WikiView(current);
  const tasks = new TasksView(current, (paths, status, epic) => actions.move(paths, status, epic));
  const GROUPING = "genbeya.tasksByEpic";
  const groupByEpic = (on: boolean) => {
    tasks.byEpic = on;
    tasks.refresh();
    void context.workspaceState.update(GROUPING, on);
    void vscode.commands.executeCommand("setContext", GROUPING, on);
  };
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
  const webviews = new Webviews(context.extensionUri, { repository: current, edit, tasks: actions });
  const language = new MarkdownLanguage(current, webviews);
  const redraw = () => {
    wiki.refresh();
    tasks.refresh();
    void files.checkOpenDocuments();
    void webviews.refresh();
    language.refresh();
    showContentBranch();
  };
  /** The content branch, and how far it is ahead of and behind its remote, in the views' titles. */
  const showContentBranch = () => {
    const storage = repository?.snapshot.storage;
    const syncing = !!storage && syncsContentBranch(storage);
    void vscode.commands.executeCommand("setContext", "genbeya.contentBranch", syncing);
    let description: string | undefined;
    if (syncing) {
      const { name, ahead, behind } = storage.branch;
      const counts = [ahead && `${ahead}↑`, behind && `${behind}↓`].filter(Boolean).join(" ");
      description = `${name}${counts ? ` ${counts}` : ""}`;
    }
    wikiTree.description = tasksTree.description = description;
  };
  groupByEpic(context.workspaceState.get<boolean>(GROUPING, false));

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

  /** The tasks a context menu command is for: the selection it was opened on, or the one item. */
  const chosenTasks = (element?: TaskElement, selected?: readonly TaskElement[]) =>
    (selected?.length ? selected : element ? [element] : tasksTree.selection).flatMap((item) => (item.kind === "task" ? [item.task] : []));

  const command = (name: string, run: (...args: never[]) => Promise<unknown>) => vscode.commands.registerCommand(name, run);

  context.subscriptions.push(
    wikiTree,
    tasksTree,
    vscode.workspace.registerFileSystemProvider(CONTENT_SCHEME, files, { isCaseSensitive: true }),
    vscode.workspace.registerTextDocumentContentProvider(REVISION_SCHEME, new RevisionFiles(current)),
    vscode.workspace.onDidChangeWorkspaceFolders(() => void open()),
    webviews,
    language,
    command(
      "genbeya.previewToSide",
      withRepository(async () => language.previewToSide()),
    ),
    command("genbeya.groupByEpic", async () => groupByEpic(true)),
    command("genbeya.groupByStatus", async () => groupByEpic(false)),
    command(
      PREVIEW_COMMAND,
      withRepository(async (_, item?: Item) => {
        const target = targetOf(item);
        if (target) await webviews.showPreview(target);
      }),
    ),
    command(
      "genbeya.edit",
      withRepository(async (_, item?: Item) => {
        const target = targetOf(item) ?? webviews.activePreview;
        if (target) await edit(target);
      }),
    ),
    command(
      "genbeya.openBoard",
      withRepository(async () => webviews.showBoard()),
    ),
    command(
      "genbeya.refresh",
      withRepository((repository) => repository.refresh()),
    ),
    command(
      "genbeya.syncContent",
      withRepository(async (repository) => {
        await vscode.window.withProgress({ location: { viewId: "genbeya.tasks" }, title: "Syncing" }, () =>
          repository.backend.content.syncContent(repository.id),
        );
        await repository.refresh();
      }),
    ),
    command(
      "genbeya.newTask",
      withRepository(async () => {
        const task = await actions.create();
        if (task) await webviews.showPreview({ area: "tasks", path: task.path });
      }),
    ),
    ...Object.entries(PROPERTY_COMMANDS).map(([name, property]) =>
      command(
        name,
        withRepository(async (repository, element?: TaskElement, selected?: readonly TaskElement[]) => {
          const chosen = chosenTasks(element, selected);
          if (property === "status" && chosen.length > 1) {
            const statuses = repository.snapshot.settings.statuses;
            const status = await vscode.window.showQuickPick([...statuses], { title: `Move ${chosen.length} tasks to` });
            if (status)
              await actions.move(
                chosen.map((task) => task.path),
                status,
              );
          } else if (chosen[0]) await actions.pick(chosen[0].path, property);
        }),
      ),
    ),
    command(
      "genbeya.deleteTask",
      withRepository(async (_, element?: TaskElement) => {
        const [task] = chosenTasks(element);
        if (task) await actions.delete(task.path);
      }),
    ),
    command(
      "genbeya.newPage",
      withRepository(async (repository, parent?: WikiNode) => {
        const root = repository.snapshot.settings.wikiRoot;
        const name = await vscode.window.showInputBox({
          title: "New page",
          prompt: `Use / to nest pages. The page is saved as Markdown in ${root}/.`,
          value: parent?.path ? `${pageName(parent.path, root)}/` : "",
          placeHolder: "Architecture/Database",
          validateInput: (value) => pageNameProblem(value) ?? undefined,
        });
        if (!name) return;
        const page = await managers.content.createPage(repository.id, pagePath(root, name));
        await repository.refresh();
        await edit({ area: "wiki", path: page.path });
      }),
    ),
    command(
      "genbeya.movePage",
      withRepository(async (repository, node?: WikiNode) => {
        if (!node?.path) return;
        const from = node.path;
        const root = repository.snapshot.settings.wikiRoot;
        const name = await vscode.window.showInputBox({
          title: `Move ${node.title}`,
          prompt: "The new name; / nests the page. Subpages move along.",
          value: pageName(from, root),
          validateInput: (value) => pageNameProblem(value) ?? undefined,
        });
        if (!name) return;
        const to = pagePath(root, name);
        if (to === from) return;
        const links = await managers.content.pageLinks(repository.id, from, to);
        let updateLinks = false;
        if (links.length) {
          const changes = links.reduce((count, link) => count + link.changes.length, 0);
          const answer = await vscode.window.showInformationMessage(
            `Update ${changes === 1 ? "the link" : `${changes} links`} to ${node.title} in ${links.length === 1 ? "1 file" : `${links.length} files`}?`,
            { modal: true },
            "Update Links",
            "Move Only",
          );
          if (!answer) return;
          updateLinks = answer === "Update Links";
        }
        await managers.content.movePage(repository.id, from, to, { updateLinks });
        await repository.refresh();
      }),
    ),
    command(
      "genbeya.deletePage",
      withRepository(async (repository, node?: WikiNode) => {
        if (!node?.path) return;
        const answer = await vscode.window.showWarningMessage(
          `Delete ${node.title}?`,
          { modal: true, detail: "The file is removed from the working tree; Git history keeps it." },
          "Delete",
        );
        if (answer !== "Delete") return;
        await managers.content.deletePage(repository.id, node.path);
        await repository.refresh();
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

/** What commands on pages and tasks get: a tree item, or a page or task named directly. */
type Item = WikiNode | TaskElement | Target;

function targetOf(item: Item | undefined): Target | null {
  if (!item) return null;
  if ("area" in item) return item;
  if ("kind" in item) return item.kind === "task" ? { area: "tasks", path: item.task.path } : null;
  return item.path ? { area: "wiki", path: item.path } : null;
}
