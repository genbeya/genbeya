/**
 * The kit's editor: CodeMirror as the app sets it up, with `[[`, `@` and `//`
 * completion from the context the kit already has, so no keystroke waits for
 * the host. The host's toolbar drives it with editor commands; the host
 * writes what it saves. Loaded the first time the host asks for an editor.
 */
import { completionStatus } from "@codemirror/autocomplete";
import { redo, undo } from "@codemirror/commands";
import { Compartment, EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editingSetup, isProse, languageFor } from "../../client/app/editor/editor-setup";
import { openFindCommand } from "../../client/app/editor/find-widget";
import { markdownCompletion } from "../../client/app/editor/markdown-completion";
import type { ReferenceCandidate } from "../../client/app/editor/reference-completion";
import type { Person } from "../../contracts/model";
import type { KitBridge } from "./bridge";
import type { EditorCommand, ToKit } from "./protocol";

type Opened = Extract<ToKit, { type: "edit" }>;

export interface EditorContext {
  readonly references: () => readonly ReferenceCandidate[];
  readonly people: () => readonly Person[];
}

/** How long typing pauses before the draft goes to the host. */
const DRAFT_DELAY = 500;

export class KitEditor {
  private readonly view: EditorView;
  private readonly language = new Compartment();
  private saved: string;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    parent: HTMLElement,
    private readonly file: Opened,
    context: EditorContext,
    private readonly bridge: KitBridge,
  ) {
    this.saved = file.text;
    const prose = isProse(file.path);
    const extensions: Extension[] = [
      ...editingSetup(!prose),
      file.readOnly ? EditorState.readOnly.of(true) : [],
      this.language.of([]),
      prose ? [markdownCompletion({ references: context.references, people: context.people }), EditorView.lineWrapping] : [],
      EditorView.contentAttributes.of({ "aria-label": file.path, spellcheck: prose ? "true" : "false" }),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (this.save(), true) }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.changed();
        if (update.docChanged || update.selectionSet || completionStatus(update.startState) !== completionStatus(update.state))
          this.report();
      }),
    ];
    this.view = new EditorView({ state: EditorState.create({ doc: file.text, extensions }), parent });
    this.report();
    void languageFor(file.path).then((support) => {
      if (support) this.view.dispatch({ effects: this.language.reconfigure(support) });
    });
  }

  get path(): string {
    return this.file.path;
  }

  focus(): void {
    this.view.focus();
  }

  destroy(): void {
    clearTimeout(this.draftTimer);
    this.view.destroy();
  }

  /** Runs a command of the host's toolbar. */
  run(command: EditorCommand, text = ""): void {
    const view = this.view;
    if (command === "undo") undo(view);
    else if (command === "redo") redo(view);
    else if (command === "find") openFindCommand(view);
    else if (command === "save") this.save();
    else if (!this.file.readOnly) {
      if (command === "insert") view.dispatch(view.state.replaceSelection(text));
      else if (command === "bold") this.wrap("**", "**");
      else if (command === "italic") this.wrap("*", "*");
      else if (command === "link") this.wrap("[", "]()");
      else if (command === "heading") this.prefix("# ", /^#{1,6} /);
      else if (command === "list") this.prefix("- ", /^- (?!\[[ xX]\] )/);
      else if (command === "checkbox") this.prefix("- [ ] ", /^- \[[ xX]\] /);
    }
    view.focus();
  }

  private get dirty(): boolean {
    return this.view.state.sliceDoc() !== this.saved;
  }

  /** Puts `before` and `after` around each selection, or between them where nothing is selected. */
  private wrap(before: string, after: string) {
    const { state } = this.view;
    this.view.dispatch(
      state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: before },
          { from: range.to, insert: after },
        ],
        range: EditorSelection.range(range.from + before.length, range.to + before.length),
      })),
    );
  }

  /** Adds `prefix` to the start of each selected line, or takes away what `present` matches there. */
  private prefix(prefix: string, present: RegExp) {
    const { state } = this.view;
    const lines = new Set<number>();
    for (const range of state.selection.ranges)
      for (let line = state.doc.lineAt(range.from).number; line <= state.doc.lineAt(range.to).number; line++) lines.add(line);
    const changes = [...lines].map((number) => {
      const line = state.doc.line(number);
      const match = present.exec(line.text);
      return match ? { from: line.from, to: line.from + match[0].length } : { from: line.from, insert: prefix };
    });
    this.view.dispatch({ changes });
  }

  private save() {
    if (this.file.readOnly) return;
    const text = this.view.state.sliceDoc();
    this.bridge.post({ type: "save", path: this.file.path, hash: this.file.hash, text });
    // The host writes it and opens the new version with an `edit` of its own; until then it counts as saved.
    this.saved = text;
    this.report();
  }

  private changed() {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      if (this.dirty) this.bridge.post({ type: "draft", path: this.file.path, hash: this.file.hash, text: this.view.state.sliceDoc() });
    }, DRAFT_DELAY);
  }

  private report() {
    const { main } = this.view.state.selection;
    this.bridge.post({
      type: "editorState",
      path: this.file.path,
      dirty: this.dirty,
      selection: { from: main.from, to: main.to },
      completing: completionStatus(this.view.state) !== null,
    });
  }
}
