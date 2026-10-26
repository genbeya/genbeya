/**
 * Genbeya's Markdown in VS Code's editor: completion of `[[references]]`,
 * `@mentions` and `//dates`, hovers and links on references, warnings for
 * references to nothing, and a preview beside the editor that scrolls along.
 * The rules are the app's: what `[[` offers, what a reference points to, who
 * `@` finds, which dates `//` suggests.
 */
import * as vscode from "vscode";
import { referenceCandidates } from "../../client/app/markdown/references";
import { MENTION_TRIGGER, mentionSuggestions, mentionText } from "../../client/app/editor/mention-suggestions";
import { DATE_TRIGGER, dateSuggestions } from "../../client/app/editor/smart-dates";
import { formatDate, today } from "../../client/app/ui/calendar-date";
import { titleCase } from "../../client/app/features/tasks/task-model";
import { fileFragment, findReference, type FoundReference } from "../../utilities/references";
import { codeRanges, openReference, referencesIn } from "./markdown-references";
import type { Repository } from "./repository";
import type { Target, Webviews } from "./webviews";

export const FOLLOW_COMMAND = "genbeya.followReference";
const SELECTOR: vscode.DocumentSelector = [
  { language: "markdown", scheme: "file" },
  { language: "markdown", scheme: "genbeya-content" },
];

type Found = FoundReference<{ readonly id: string; readonly path: string; readonly title: string; readonly status: string }>;

export class MarkdownLanguage implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection("genbeya");
  private readonly subscriptions: vscode.Disposable[] = [this.diagnostics];
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly repository: () => Repository | undefined,
    private readonly webviews: Webviews,
  ) {
    this.subscriptions.push(
      vscode.languages.registerCompletionItemProvider(
        SELECTOR,
        { provideCompletionItems: (document, position) => this.complete(document, position) },
        "[",
        "@",
        "/",
      ),
      vscode.languages.registerHoverProvider(SELECTOR, { provideHover: (document, position) => this.hover(document, position) }),
      vscode.languages.registerDocumentLinkProvider(SELECTOR, { provideDocumentLinks: (document) => this.links(document) }),
      vscode.commands.registerCommand(FOLLOW_COMMAND, (target: string) => this.follow(target)),
      vscode.workspace.onDidOpenTextDocument((document) => this.check(document)),
      vscode.workspace.onDidChangeTextDocument(({ document }) => this.checkSoon(document)),
      vscode.workspace.onDidCloseTextDocument((document) => this.diagnostics.delete(document.uri)),
      vscode.window.onDidChangeActiveTextEditor(() => this.updateContext()),
      vscode.window.onDidChangeTextEditorVisibleRanges(({ textEditor }) => this.scroll(textEditor)),
    );
  }

  /** Checks every open document and updates the editor's context, after the snapshot changed. */
  refresh(): void {
    for (const document of vscode.workspace.textDocuments) this.check(document);
    this.updateContext();
  }

  /** A document's place in the repository: its path, and the area it is a page or task of. */
  private place(document: vscode.TextDocument): { repository: Repository; path: string; target: Target | null } | null {
    const repository = this.repository();
    if (!repository || document.languageId !== "markdown") return null;
    const path = repository.pathOf(document.uri);
    if (path === null) return null;
    const area = repository.areaOf(path);
    return { repository, path, target: area ? { area, path } : null };
  }

  /** `genbeya.documentArea`: whether the active editor shows a page or task, for the Preview to the Side button. */
  private updateContext() {
    const editor = vscode.window.activeTextEditor;
    const target = editor ? this.place(editor.document)?.target : null;
    void vscode.commands.executeCommand("setContext", "genbeya.documentArea", target?.area ?? "");
  }

  /** Opens the active page or task's preview beside the editor. */
  async previewToSide(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const target = editor && this.place(editor.document)?.target;
    if (!target || !editor) return;
    await this.webviews.showPreview(target, { column: vscode.ViewColumn.Beside, preserveFocus: true });
    this.scroll(editor);
  }

  /** Keeps a preview of the document at the same share of its length as the editor. */
  private scroll(editor: vscode.TextEditor) {
    const target = this.place(editor.document)?.target;
    const range = editor.visibleRanges[0];
    if (!target || !range) return;
    const visible = range.end.line - range.start.line;
    const scrollable = Math.max(1, editor.document.lineCount - visible);
    this.webviews.scrollPreview(target, Math.min(1, range.start.line / scrollable));
  }

  private async complete(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[] | undefined> {
    const place = this.place(document);
    if (!place) return;
    const offset = document.offsetAt(position);
    if (codeRanges(document.getText()).some(([start, end]) => offset > start && offset < end)) return;
    const before = document.lineAt(position).text.slice(0, position.character);
    const after = document.lineAt(position).text.slice(position.character);
    const typed = openReference(before);
    if (typed !== null) {
      // Closing brackets already there are replaced, so the cursor ends up after them.
      const closed = after.startsWith("]]");
      const range = new vscode.Range(position.translate(0, -typed.length), position.translate(0, closed ? 2 : 0));
      return referenceCandidates(place.repository.references).map((candidate) => {
        const item = new vscode.CompletionItem(
          candidate.label,
          candidate.kind === "task"
            ? vscode.CompletionItemKind.Issue
            : candidate.kind === "page"
              ? vscode.CompletionItemKind.Text
              : vscode.CompletionItemKind.File,
        );
        item.detail = candidate.detail;
        item.insertText = `${candidate.target}]]`;
        item.filterText = candidate.label;
        item.range = range;
        return item;
      });
    }
    const mention = MENTION_TRIGGER.exec(before);
    if (mention) {
      const range = new vscode.Range(position.translate(0, -mention[0].length), position);
      return mentionSuggestions(await place.repository.people(), mention[1]!).map((person, index) => {
        const item = new vscode.CompletionItem({ label: person.name, description: `@${person.handle}` }, vscode.CompletionItemKind.User);
        item.insertText = mentionText(person, after);
        item.filterText = `@${person.handle} ${person.name} ${person.email ?? ""}`;
        item.sortText = String(index).padStart(3, "0");
        item.range = range;
        return item;
      });
    }
    const date = DATE_TRIGGER.exec(before);
    if (date) {
      const range = new vscode.Range(position.translate(0, -date[0].length), position);
      return dateSuggestions(date[1]!, today()).flatMap(({ label, date: iso }, index) => {
        if (!iso) return [];
        const item = new vscode.CompletionItem({ label, description: formatDate(iso, { weekday: true }) }, vscode.CompletionItemKind.Value);
        item.insertText = iso;
        item.filterText = date[0];
        item.sortText = String(index).padStart(3, "0");
        item.range = range;
        return [item];
      });
    }
    return;
  }

  private find(repository: Repository, target: string): Found {
    return findReference(target, repository.referenceIndex);
  }

  private hover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const place = this.place(document);
    if (!place) return;
    const offset = document.offsetAt(position);
    const link = referencesIn(document.getText()).find((candidate) => offset >= candidate.start && offset < candidate.end);
    if (!link) return;
    const found = this.find(place.repository, link.target);
    const text = new vscode.MarkdownString();
    switch (found.kind) {
      case "task": {
        const task = place.repository.snapshot.tasks.find((candidate) => candidate.path === found.task.path);
        text.appendMarkdown(`**${found.task.id}** `).appendText(found.task.title);
        text
          .appendMarkdown("\n\n")
          .appendText([titleCase(found.task.status), task?.type && titleCase(task.type), task?.assignee].filter(Boolean).join(" · "));
        break;
      }
      case "page":
        text.appendMarkdown("**").appendText(found.page.title).appendMarkdown("**\n\n").appendText(found.page.path);
        break;
      case "file":
        text.appendText(
          found.path +
            (found.lines ? `, lines ${found.lines.from}–${found.lines.to}` : "") +
            (found.revision ? `, as of ${found.revision}` : ""),
        );
        if (!found.exists && !found.revision) text.appendMarkdown("\n\n").appendText("This file doesn't exist.");
        break;
      case "missing":
        text.appendText(`No task or page is named “${link.target}”. Ctrl+click to create the page.`);
        break;
    }
    return new vscode.Hover(text, new vscode.Range(document.positionAt(link.start), document.positionAt(link.end)));
  }

  private links(document: vscode.TextDocument): vscode.DocumentLink[] {
    if (!this.place(document)) return [];
    return referencesIn(document.getText()).map((link) => {
      const range = new vscode.Range(document.positionAt(link.start + 2), document.positionAt(link.end - 2));
      const uri = vscode.Uri.parse(`command:${FOLLOW_COMMAND}?${encodeURIComponent(JSON.stringify([link.target]))}`);
      const documentLink = new vscode.DocumentLink(range, uri);
      documentLink.tooltip = "Follow the reference";
      return documentLink;
    });
  }

  /** Opens what a reference points to: a task's or page's preview, a file, or a new page. */
  private async follow(target: string): Promise<void> {
    const repository = this.repository();
    if (!repository) return;
    const found = this.find(repository, target);
    switch (found.kind) {
      case "task":
        return this.webviews.follow(repository, { kind: "file", path: found.task.path, anchor: undefined });
      case "page":
        return this.webviews.follow(repository, { kind: "file", path: found.page.path, anchor: undefined });
      case "file":
        return this.webviews.follow(repository, { kind: "file", path: found.path, anchor: fileFragment(found) || undefined });
      case "missing":
        return this.webviews.follow(repository, { kind: "missing", title: target.split("#")[0]!.trim() });
    }
  }

  private checkSoon(document: vscode.TextDocument) {
    const key = document.uri.toString();
    clearTimeout(this.pending.get(key));
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key);
        this.check(document);
      }, 300),
    );
  }

  /** Warns about references to tasks, pages and files that don't exist; a pinned file only has to be in its revision. */
  private check(document: vscode.TextDocument) {
    const place = this.place(document);
    if (!place) return this.diagnostics.delete(document.uri);
    const problems: vscode.Diagnostic[] = [];
    for (const link of referencesIn(document.getText())) {
      const found = this.find(place.repository, link.target);
      const message =
        found.kind === "missing"
          ? `No task or page is named “${link.target}”.`
          : found.kind === "file" && !found.exists && !found.revision
            ? `The file ${found.path} doesn't exist.`
            : null;
      if (!message) continue;
      const range = new vscode.Range(document.positionAt(link.start), document.positionAt(link.end));
      const problem = new vscode.Diagnostic(range, message, vscode.DiagnosticSeverity.Warning);
      problem.source = "Genbeya";
      problems.push(problem);
    }
    this.diagnostics.set(document.uri, problems);
  }

  dispose() {
    for (const timer of this.pending.values()) clearTimeout(timer);
    for (const subscription of this.subscriptions) subscription.dispose();
  }
}
