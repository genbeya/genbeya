/**
 * The webviews: a preview tab per page or task, rendered as the app renders
 * it, and the board. Both get what they show from the snapshot and report
 * what the user does; links, edits and moves happen here, through the
 * managers, which check every path. VS Code reopens them after a restart.
 */
import * as vscode from "vscode";
import type { ContentArea } from "../../contracts/model";
import { TaskEngine } from "../../engines/task-engine";
import { toggleCheckboxAt } from "../../client/app/markdown/task-checkbox";
import { flattenPages } from "../../client/app/features/wiki/wiki-pages";
import { filePaths } from "../../utilities/file-tree";
import { parseFileFragment, pinnedText } from "../../utilities/references";
import type { Repository } from "./repository";
import { RevisionFiles } from "./revision-files";
import type { TaskActions } from "./task-actions";
import type { FollowedLink, FromWebview, MarkdownContext, PreviewDocument, ToWebview } from "./webview/protocol";

export const PREVIEW_VIEW = "genbeya.preview";
export const BOARD_VIEW = "genbeya.board";

/** A page or task, by its area and path. */
export interface Target {
  readonly area: ContentArea;
  readonly path: string;
}

/** What the webviews need from the rest of the extension. */
export interface Host {
  repository(): Repository | undefined;
  /** Opens the file to edit it. */
  edit(target: Target): Promise<void>;
  readonly tasks: TaskActions;
}

interface Preview {
  readonly panel: vscode.WebviewPanel;
  target: Target;
  /** A task's ID, to follow it when it moves to another epic (another folder). */
  taskId: string | null;
}

const taskEngine = new TaskEngine();
const keyOf = (target: Target) => `${target.area}:${target.path}`;

export class Webviews implements vscode.Disposable {
  private readonly previews = new Map<string, Preview>();
  private board: vscode.WebviewPanel | null = null;
  private readonly subscriptions: vscode.Disposable[] = [];
  private readonly pendingEdits = new Map<Preview, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly extension: vscode.Uri,
    private readonly host: Host,
  ) {
    this.subscriptions.push(
      // Previews follow edits of what they show, as VS Code's Markdown preview does.
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        const repository = this.host.repository();
        for (const preview of this.previews.values()) {
          if (document.uri.toString() !== repository?.uri(preview.target.area, preview.target.path).toString()) continue;
          clearTimeout(this.pendingEdits.get(preview));
          this.pendingEdits.set(
            preview,
            setTimeout(() => void this.updatePreview(preview), 150),
          );
        }
      }),
      vscode.window.registerWebviewPanelSerializer(PREVIEW_VIEW, {
        deserializeWebviewPanel: async (panel, state: Partial<Target> | undefined) => {
          if (state?.area && state.path) await this.adopt(panel, { area: state.area, path: state.path });
          else panel.dispose();
        },
      }),
      vscode.window.registerWebviewPanelSerializer(BOARD_VIEW, {
        deserializeWebviewPanel: async (panel) => {
          if (this.board) panel.dispose();
          else this.adoptBoard(panel);
        },
      }),
    );
  }

  /** What the active preview shows, for its Edit button. */
  get activePreview(): Target | null {
    return [...this.previews.values()].find((preview) => preview.panel.active)?.target ?? null;
  }

  /** Shows a page or task in its own preview tab, opening it if needed: in the active editor group unless `column` says otherwise. */
  async showPreview(target: Target, place: { column?: vscode.ViewColumn; preserveFocus?: boolean } = {}): Promise<void> {
    const open = this.previews.get(keyOf(target));
    if (open) return open.panel.reveal(place.column, place.preserveFocus);
    const column = { viewColumn: place.column ?? vscode.ViewColumn.Active, preserveFocus: place.preserveFocus ?? false };
    const panel = vscode.window.createWebviewPanel(PREVIEW_VIEW, target.path, column, this.options(false));
    await this.adopt(panel, target);
  }

  /** Scrolls a page or task's open preview to a share of its length, following its editor. */
  scrollPreview(target: Target, ratio: number): void {
    void this.previews.get(keyOf(target))?.panel.webview.postMessage({ type: "scroll", ratio } satisfies ToWebview);
  }

  private async adopt(panel: vscode.WebviewPanel, target: Target) {
    const preview: Preview = { panel, target, taskId: null };
    this.previews.set(keyOf(target), preview);
    panel.onDidDispose(() => {
      this.previews.delete(keyOf(preview.target));
      clearTimeout(this.pendingEdits.get(preview));
      this.pendingEdits.delete(preview);
    });
    this.setUp(panel, "preview", (message) => this.receive(panel, message, preview));
    await this.updatePreview(preview);
  }

  showBoard(): void {
    if (this.board) return this.board.reveal();
    this.adoptBoard(vscode.window.createWebviewPanel(BOARD_VIEW, "Board", vscode.ViewColumn.Active, this.options(true)));
  }

  private adoptBoard(panel: vscode.WebviewPanel) {
    this.board = panel;
    panel.title = "Board";
    panel.onDidDispose(() => (this.board = null));
    this.setUp(panel, "board", (message) => this.receive(panel, message, null));
  }

  /** Shows the new snapshot in the open webviews. */
  async refresh(): Promise<void> {
    await Promise.all([...[...this.previews.values()].map((preview) => this.updatePreview(preview)), this.updateBoard()]);
  }

  private options(board: boolean): vscode.WebviewPanelOptions & vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(this.extension, "webview")], retainContextWhenHidden: board };
  }

  private setUp(panel: vscode.WebviewPanel, entry: "preview" | "board", receive: (message: FromWebview) => Promise<void>) {
    const assets = vscode.Uri.joinPath(this.extension, "webview");
    panel.webview.options = this.options(entry === "board");
    panel.iconPath = vscode.Uri.joinPath(this.extension, "genbeya-mono.svg");
    panel.webview.html = page(panel.webview, assets, entry);
    panel.webview.onDidReceiveMessage((message: FromWebview) => void receive(message));
  }

  private async receive(panel: vscode.WebviewPanel, message: FromWebview, preview: Preview | null) {
    const repository = this.host.repository();
    if (!repository) return;
    const { tasks } = this.host;
    const reply = async (id: number, value: Promise<string>) => {
      let answer: ToWebview;
      try {
        answer = { type: "reply", id, value: await value };
      } catch (error) {
        answer = { type: "reply", id, error: errorText(error) };
      }
      await panel.webview.postMessage(answer);
    };
    try {
      switch (message.type) {
        case "ready":
          return await (preview ? this.updatePreview(preview) : this.updateBoard());
        case "follow":
          return await this.follow(repository, message.link);
        case "preview":
          return await this.showPreview({ area: message.area, path: message.path });
        case "edit":
          return await this.host.edit({ area: message.area, path: message.path });
        case "toggle":
          return await this.toggle(repository, message.area, message.path, message.offset);
        case "move":
          return await tasks.move(message.paths, message.status, message.epic);
        case "pick":
          await tasks.pick(message.path, message.property);
          return;
        case "field":
          await tasks.setField(message.path, message.name, message.value);
          return;
        case "comment":
          await tasks.comment(message.path, message.text);
          return;
        case "editComment":
          await tasks.editComment(message.path, message.hash, message.index, message.text);
          return;
        case "deleteComment":
          return await tasks.deleteComment(message.path, message.hash, message.index);
        case "delete":
          if ((await tasks.delete(message.path)) && preview) panel.dispose();
          return;
        case "newTask": {
          const task = await tasks.create(message.status, message.epic);
          if (task) await this.showPreview({ area: "tasks", path: task.path });
          return;
        }
        case "image":
          return await reply(message.id, repository.backend.content.image(repository.id, "content", message.path));
        case "file":
          return await reply(
            message.id,
            repository.backend.content.read(repository.id, "repo", message.path).then((file) => file.content),
          );
        case "fileAt":
          return await reply(
            message.id,
            repository.backend.versionControl
              .fileAt(repository.id, message.revision, message.path)
              .then((file) => pinnedText(file, message.path, message.revision)),
          );
        case "activity":
          return await reply(message.id, tasks.activity(message.path));
      }
    } catch (error) {
      void vscode.window.showErrorMessage(errorText(error));
      // A board that moved a card early shows where it really is.
      if (!preview) await this.updateBoard();
    }
  }

  /** Pages and tasks open in their preview, other files in the editor, web links in the browser. */
  async follow(repository: Repository, link: FollowedLink): Promise<void> {
    const { snapshot } = repository;
    if (link.kind === "external") {
      if (/^(https?|mailto):/i.test(link.url)) await vscode.env.openExternal(vscode.Uri.parse(link.url));
      return;
    }
    if (link.kind === "missing") {
      const create = await vscode.window.showInformationMessage(`The page "${link.title}" doesn't exist yet.`, "Create Page");
      if (!create) return;
      const page = await repository.backend.content.createPage(repository.id, `${snapshot.settings.wikiRoot}/${link.title}.md`);
      await repository.refresh();
      return this.host.edit({ area: "wiki", path: page.path });
    }
    let { path } = link;
    const root = snapshot.settings.wikiRoot;
    const { lines, revision } = parseFileFragment(link.anchor);
    // Links into the wiki may leave out `.md`, or point at a page's folder; a pinned link shows the file as it was.
    if ((path === root || path.startsWith(`${root}/`)) && !/\.[a-z0-9]+$/i.test(path)) path += ".md";
    if (!revision && snapshot.tasks.some((task) => task.path === path)) return this.showPreview({ area: "tasks", path });
    if (!revision && flattenPages(snapshot.wiki).some((page) => page.path === path)) return this.showPreview({ area: "wiki", path });
    const uri = revision ? RevisionFiles.uri(link.path, revision) : vscode.Uri.joinPath(repository.folder, link.path);
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    if (lines) {
      const from = Math.min(lines.from, document.lineCount) - 1;
      const to = Math.min(lines.to, document.lineCount) - 1;
      editor.selection = new vscode.Selection(from, 0, to, document.lineAt(to).text.length);
      editor.revealRange(editor.selection, vscode.TextEditorRevealType.InCenter);
    }
  }

  /** Ticks or unticks a checklist item of a page or a task's description. */
  private async toggle(repository: Repository, area: ContentArea, path: string, offset: number) {
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === repository.uri(area, path).toString());
    if (open?.isDirty) {
      void vscode.window.showWarningMessage(`Save ${path} first; it has changes that are not saved.`);
      return;
    }
    if (area === "tasks") {
      await this.host.tasks.update(path, (task) => ({ body: toggleCheckboxAt(task.body, offset) }));
      return;
    }
    const { content } = repository.backend;
    const file = await content.read(repository.id, "content", path);
    await content.write(repository.id, "content", path, toggleCheckboxAt(file.content, offset), file.hash);
    await repository.refresh();
  }

  private async updatePreview(preview: Preview) {
    const repository = this.host.repository();
    if (!repository) return;
    this.followMove(repository, preview);
    const document = await this.document(repository, preview.target);
    if (!document) {
      preview.panel.title = `${preview.target.path} (deleted)`;
      return;
    }
    if (document.kind === "task") preview.taskId = document.task.id;
    preview.panel.title = document.kind === "task" ? `${document.task.id}: ${document.task.title}` : document.title;
    const message: ToWebview = { type: "preview", document, context: await this.context(repository) };
    void preview.panel.webview.postMessage(message);
  }

  /** A task moved to another epic is another file: the preview follows it by its ID. */
  private followMove(repository: Repository, preview: Preview) {
    const { target, taskId } = preview;
    if (target.area !== "tasks" || !taskId || repository.snapshot.tasks.some((task) => task.path === target.path)) return;
    const moved = repository.snapshot.tasks.find((task) => task.id === taskId);
    if (!moved) return;
    this.previews.delete(keyOf(target));
    preview.target = { area: "tasks", path: moved.path };
    this.previews.set(keyOf(preview.target), preview);
  }

  /** The page or task, as the editor has it while it is open there, so the preview follows typing. */
  private async document(repository: Repository, target: Target): Promise<PreviewDocument | null> {
    const uri = repository.uri(target.area, target.path).toString();
    const open = vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri);
    if (target.area === "tasks") {
      const saved = repository.snapshot.tasks.find((task) => task.path === target.path);
      if (!saved) return null;
      if (!open?.isDirty) return { kind: "task", task: saved };
      try {
        return { kind: "task", task: taskEngine.parse(target.path, open.getText(), saved.hash, repository.snapshot.settings.taskRoot) };
      } catch {
        return { kind: "task", task: saved };
      }
    }
    const page = flattenPages(repository.snapshot.wiki).find((candidate) => candidate.path === target.path);
    if (!page && !open) return null;
    const title = page?.title ?? target.path;
    try {
      const source = open ? open.getText() : (await repository.backend.content.read(repository.id, "content", target.path)).content;
      return { kind: "page", path: target.path, title, source };
    } catch (error) {
      return { kind: "page", path: target.path, title, source: `> [!WARNING]\n> ${errorText(error)}` };
    }
  }

  private async updateBoard() {
    const repository = this.host.repository();
    if (!this.board || !repository) return;
    const message: ToWebview = { type: "board", tasks: repository.snapshot.tasks, context: await this.context(repository) };
    void this.board.webview.postMessage(message);
  }

  private async context(repository: Repository): Promise<MarkdownContext> {
    const { snapshot } = repository;
    const { settings } = snapshot;
    return {
      version: snapshot.version,
      wikiRoot: settings.wikiRoot,
      wiki: snapshot.wiki,
      tasks: snapshot.tasks.map(({ id, path, title, status }) => ({ id, path, title, status })),
      statuses: settings.statuses,
      hiddenColumns: settings.hiddenColumns,
      types: settings.types,
      fields: settings.fields,
      files: filePaths(snapshot.files),
      people: await repository.people(),
      author: await repository.author(),
    };
  }

  dispose() {
    for (const preview of [...this.previews.values()]) preview.panel.dispose();
    this.board?.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The webview's page: its script and styles from the extension, nothing else. Markdown never becomes HTML (see markdown-dom.ts). */
function page(webview: vscode.Webview, assets: vscode.Uri, entry: "preview" | "board"): string {
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(assets, name)).toString();
  const nonce = [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const policy = [
    "default-src 'none'",
    // Rockuml compiles WebAssembly; Mermaid measures text with inline styles.
    `script-src 'nonce-${nonce}' ${webview.cspSource} 'wasm-unsafe-eval'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `img-src ${webview.cspSource} data: blob:`,
    `font-src ${webview.cspSource}`,
    `connect-src ${webview.cspSource}`,
  ].join("; ");
  const body =
    entry === "preview"
      ? `<main id="root" class="gb-preview"></main>`
      : `<main id="root"></main>
<dialog id="popup" class="gb-popup" aria-labelledby="popup-id">
  <div class="gb-popup-bar">
    <span id="popup-id" class="gb-id"></span>
    <span class="gb-spacer"></span>
    <button id="popup-preview" type="button">Open in Preview</button>
    <button id="popup-edit" type="button" class="is-primary">Edit File</button>
    <button id="popup-delete" type="button">Delete</button>
    <button id="popup-close" type="button" aria-label="Close">✕</button>
  </div>
  <div id="popup-body" class="gb-popup-body"></div>
</dialog>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset("styles.css")}">
</head>
<body data-rockuml="${asset("rockuml.wasm")}">
${body}
<script type="module" nonce="${nonce}" src="${asset(`${entry}.js`)}"></script>
</body>
</html>`;
}
