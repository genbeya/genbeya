/**
 * The webviews: the preview, which shows one page or task at a time as the
 * app renders it, and the board. Both get what they show from the snapshot
 * and report clicks back; links, edits and moves happen here, through the
 * managers, which check every path.
 */
import * as vscode from "vscode";
import type { ContentArea, Person, Task } from "../../contracts/model";
import { TaskEngine } from "../../engines/task-engine";
import { toggleCheckboxAt } from "../../client/app/markdown/task-checkbox";
import { flattenPages } from "../../client/app/features/wiki/wiki-pages";
import { filePaths } from "../../utilities/file-tree";
import type { Repository } from "./repository";
import { boardColumns, inputOf } from "./task-groups";
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
  /** Moves tasks to another workflow state. */
  move(tasks: readonly Task[], status: string): Promise<void>;
}

const tasks = new TaskEngine();

export class Webviews implements vscode.Disposable {
  private preview: vscode.WebviewPanel | null = null;
  /** What the preview shows. */
  private shown: Target | null = null;
  private board: vscode.WebviewPanel | null = null;
  private people: { version: string; people: Promise<readonly Person[]> } | null = null;
  private readonly subscriptions: vscode.Disposable[] = [];
  private pendingEdit: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly extension: vscode.Uri,
    private readonly host: Host,
  ) {
    // The preview follows edits of what it shows, as VS Code's Markdown preview does.
    this.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(({ document }) => {
        if (!this.shown || document.uri.toString() !== this.uriOf(this.shown)?.toString()) return;
        if (this.pendingEdit) clearTimeout(this.pendingEdit);
        this.pendingEdit = setTimeout(() => void this.updatePreview(), 150);
      }),
    );
  }

  /** What the preview shows while it is the active editor, for its Edit button. */
  get activePreview(): Target | null {
    return this.preview?.active ? this.shown : null;
  }

  /** Shows a page or task in the preview, opening it if needed. */
  async showPreview(target: Target): Promise<void> {
    this.shown = target;
    if (!this.preview) {
      this.preview = this.panel(PREVIEW_VIEW, "Preview", "preview", vscode.ViewColumn.Active);
      this.preview.onDidDispose(() => {
        this.preview = null;
        this.shown = null;
      });
    } else this.preview.reveal(undefined, false);
    await this.updatePreview();
  }

  showBoard(): void {
    if (this.board) return this.board.reveal();
    this.board = this.panel(BOARD_VIEW, "Board", "board", vscode.ViewColumn.Active);
    this.board.onDidDispose(() => (this.board = null));
  }

  /** Shows the new snapshot in the open webviews. */
  async refresh(): Promise<void> {
    await Promise.all([this.updatePreview(), this.updateBoard()]);
  }

  private panel(type: string, title: string, entry: "preview" | "board", column: vscode.ViewColumn): vscode.WebviewPanel {
    const assets = vscode.Uri.joinPath(this.extension, "webview");
    const panel = vscode.window.createWebviewPanel(type, title, column, {
      enableScripts: true,
      localResourceRoots: [assets],
      retainContextWhenHidden: entry === "board",
    });
    panel.iconPath = vscode.Uri.joinPath(this.extension, "genbeya-mono.svg");
    panel.webview.html = page(panel.webview, assets, entry);
    panel.webview.onDidReceiveMessage((message: FromWebview) => void this.receive(panel, message));
    return panel;
  }

  private async receive(panel: vscode.WebviewPanel, message: FromWebview) {
    const repository = this.host.repository();
    if (!repository) return;
    try {
      switch (message.type) {
        case "ready":
          return await (panel === this.board ? this.updateBoard() : this.updatePreview());
        case "follow":
          return await this.follow(repository, message.link);
        case "preview":
          return await this.showPreview({ area: message.area, path: message.path });
        case "edit":
          return await this.host.edit({ area: message.area, path: message.path });
        case "move": {
          const moved = repository.snapshot.tasks.filter((task) => message.paths.includes(task.path));
          return await this.host.move(moved, message.status);
        }
        case "toggle":
          return await this.toggle(repository, message.area, message.path, message.offset);
        case "image":
        case "file":
          try {
            const value =
              message.type === "image"
                ? await repository.backend.content.image(repository.id, "content", message.path)
                : (await repository.backend.content.read(repository.id, "repo", message.path)).content;
            return void panel.webview.postMessage({ type: "reply", id: message.id, value } satisfies ToWebview);
          } catch (error) {
            return void panel.webview.postMessage({ type: "reply", id: message.id, error: errorText(error) } satisfies ToWebview);
          }
      }
    } catch (error) {
      void vscode.window.showErrorMessage(errorText(error));
      // A board that moved a card early shows where it really is.
      if (panel === this.board) await this.updateBoard();
    }
  }

  /** Pages and tasks open in the preview, other files in the editor, web links in the browser. */
  private async follow(repository: Repository, link: FollowedLink) {
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
    if (snapshot.tasks.some((task) => task.path === link.path)) return this.showPreview({ area: "tasks", path: link.path });
    if (flattenPages(snapshot.wiki).some((page) => page.path === link.path)) return this.showPreview({ area: "wiki", path: link.path });
    const lines = /^L(\d+)(?:-L(\d+))?$/.exec(link.anchor ?? "");
    const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(repository.folder, link.path));
    const editor = await vscode.window.showTextDocument(document);
    if (lines) {
      const from = Number(lines[1]) - 1;
      const to = Number(lines[2] ?? lines[1]) - 1;
      editor.selection = new vscode.Selection(from, 0, to, document.lineAt(Math.min(to, document.lineCount - 1)).text.length);
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
    const { content } = repository.backend;
    if (area === "tasks") {
      const task = repository.snapshot.tasks.find((candidate) => candidate.path === path);
      if (!task) return;
      await content.updateTask(repository.id, path, { ...inputOf(task), body: toggleCheckboxAt(task.body, offset) }, task.hash);
    } else {
      const file = await content.read(repository.id, "content", path);
      await content.write(repository.id, "content", path, toggleCheckboxAt(file.content, offset), file.hash);
    }
    await repository.refresh();
  }

  private uriOf(target: Target): vscode.Uri | undefined {
    return this.host.repository()?.uri(target.area, target.path);
  }

  private async updatePreview() {
    const repository = this.host.repository();
    if (!this.preview || !this.shown || !repository) return;
    const shown = this.shown;
    const document = await this.document(repository, shown);
    if (!document || shown !== this.shown || !this.preview) return;
    this.preview.title = document.kind === "task" ? `${document.task.id}: ${document.task.title}` : document.title;
    const message: ToWebview = { type: "preview", document, context: await this.context(repository) };
    void this.preview.webview.postMessage(message);
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
        return { kind: "task", task: tasks.parse(target.path, open.getText(), saved.hash, repository.snapshot.settings.taskRoot) };
      } catch {
        return { kind: "task", task: saved };
      }
    }
    const title = flattenPages(repository.snapshot.wiki).find((page) => page.path === target.path)?.title ?? target.path;
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
    const message: ToWebview = {
      type: "board",
      columns: boardColumns(repository.snapshot.tasks, repository.snapshot.settings),
      context: await this.context(repository),
    };
    void this.board.webview.postMessage(message);
  }

  private async context(repository: Repository): Promise<MarkdownContext> {
    const { snapshot } = repository;
    if (this.people?.version !== snapshot.version) {
      const people = repository.backend.content
        .people(repository.id)
        .then((list) => list.people)
        .catch(() => []);
      this.people = { version: snapshot.version, people };
    }
    return {
      wikiRoot: snapshot.settings.wikiRoot,
      wiki: snapshot.wiki,
      tasks: snapshot.tasks.map(({ id, path, title, status }) => ({ id, path, title, status })),
      statuses: snapshot.settings.statuses,
      files: filePaths(snapshot.files),
      people: await this.people.people,
    };
  }

  dispose() {
    this.preview?.dispose();
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
<dialog id="popup" class="gb-popup" aria-label="Task">
  <div class="gb-popup-bar">
    <select id="popup-status" aria-label="Status"></select>
    <span class="gb-spacer"></span>
    <button id="popup-preview" type="button">Open in Preview</button>
    <button id="popup-edit" type="button" class="is-primary">Edit</button>
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
