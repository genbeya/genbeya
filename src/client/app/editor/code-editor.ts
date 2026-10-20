/** An editable file: CodeMirror with the language of its path. */
import { Annotation, Compartment, EditorState, type Extension, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  untracked,
} from "@angular/core";
import { Typesetter } from "../markdown/typesetter";
import { wordWrap } from "./editor-keymap";
import { editingSetup, isProse, languageFor } from "./editor-setup";
import type { Person } from "../../../contracts/model";
import { markdownCompletion } from "./markdown-completion";
import { mathPreview } from "./math-preview";
import { minimap } from "./minimap";
import type { ReferenceCandidate } from "./reference-completion";

const CRLF = String.fromCharCode(13, 10);
const isMarkdown = (path: string): boolean => /\.(md|markdown)$/i.test(path);
/** Files keep their line endings: CodeMirror would otherwise turn CRLF into LF. */
const separatorFor = (value: string): Extension => (value.includes(CRLF) ? EditorState.lineSeparator.of(CRLF) : []);
/** Lines to select and scroll to, counted from 1. */
export interface LineRange {
  readonly from: number;
  readonly to: number;
}

/** Marks text replaced from outside, which is not reported as an edit. */
const reload = Annotation.define<boolean>();

@Component({
  selector: "gd-code-editor",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "editor" },
  template: "",
  styles: `
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }
  `,
})
export class CodeEditor {
  readonly value = input.required<string>();
  /** Decides the language, and wrapping for prose. */
  readonly path = input.required<string>();
  readonly lineNumbers = input(true);
  readonly autofocus = input(false);
  readonly label = input("Editor");
  /** Shows the text without letting it be changed; it can still be selected, searched and copied. */
  readonly readOnly = input(false);
  /** Lines to select and scroll into view once the text has them (a link to `file#L10-L20`). */
  readonly reveal = input<LineRange | null>(null);
  /** Offers these after `[[` (Markdown references); null for none. */
  readonly references = input<readonly ReferenceCandidate[] | null>(null);
  /** Offers these after `@` (Markdown mentions). Markdown editors, which have either, also offer dates after `//`. */
  readonly people = input<readonly Person[] | null>(null);
  /** Shows a minimap for code; prose never has one. */
  readonly minimap = input(false);
  /** The line to show at the top when the editor opens, with a fraction for the way into it. */
  readonly startLine = input<number | null>(null);
  /** The line at the top (see {@link topLine}) whenever the user scrolls. */
  readonly scrolled = output<number>();
  readonly valueChange = output<string>();
  /** Ctrl+S (Cmd+S) inside the editor. */
  readonly save = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly typesetter = inject(Typesetter);
  private readonly language = new Compartment();
  private readonly separator = new Compartment();
  private readonly completion = new Compartment();
  private readonly overview = new Compartment();
  private readonly offersCompletion = computed(() => this.references() !== null || this.people() !== null);
  private readonly showsMinimap = computed(() => this.minimap() && !isProse(this.path()));
  private view: EditorView | null = null;

  constructor() {
    effect(() => {
      const path = this.path();
      const numbered = this.lineNumbers();
      const readOnly = this.readOnly();
      untracked(() => this.create(path, numbered, readOnly));
    });
    effect(() => {
      const value = this.value();
      const view = this.view;
      // Outside changes (reloads) replace the text; the user's own edits already match.
      if (!view || view.state.sliceDoc() === value) return;
      if ((view.state.lineBreak === CRLF) !== value.includes(CRLF))
        view.dispatch({ effects: this.separator.reconfigure(separatorFor(value)) });
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: [reload.of(true), Transaction.addToHistory.of(false)],
      });
    });
    effect(() => {
      // The extension reads the candidates when completing, so only switching it on or off reconfigures.
      const offered = this.offersCompletion();
      untracked(() => this.view?.dispatch({ effects: this.completion.reconfigure(this.completionFor(offered)) }));
    });
    effect(() => {
      const shown = this.showsMinimap();
      untracked(() => this.view?.dispatch({ effects: this.overview.reconfigure(shown ? minimap() : []) }));
    });
    let revealed: LineRange | null = null;
    effect(() => {
      const range = this.reveal();
      this.value();
      const view = this.view;
      if (!view || !range || range === revealed || range.from > view.state.doc.lines) return;
      revealed = range;
      const from = view.state.doc.line(range.from).from;
      const to = view.state.doc.line(Math.min(range.to, view.state.doc.lines)).to;
      view.dispatch({ selection: { anchor: from, head: to }, effects: EditorView.scrollIntoView(from, { y: "center" }) });
      // Following a link to lines lands in them, ready for the keyboard.
      view.focus();
    });
    // Focus and scrolling need the editor in the document.
    afterNextRender(() => {
      if (this.autofocus()) this.view?.focus();
      const line = untracked(this.startLine);
      if (line !== null) this.scrollToLine(line);
    });
    inject(DestroyRef).onDestroy(() => this.view?.destroy());
  }

  /** How far the document's top is scrolled out of view, in pixels. */
  private scrolledHeight(view: EditorView): number {
    return view.scrollDOM.getBoundingClientRect().top - view.documentTop;
  }

  /** The line at the top of the editor, with a fraction for how far into it the view is scrolled. */
  topLine(): number {
    const view = this.view;
    if (!view) return 1;
    const height = Math.max(0, this.scrolledHeight(view));
    const block = view.lineBlockAtHeight(height);
    const share = block.height ? Math.min(1, Math.max(0, (height - block.top) / block.height)) : 0;
    return view.state.doc.lineAt(block.from).number + share;
  }

  /** Scrolls so that `line` (with its fraction) is at the top. */
  scrollToLine(line: number): void {
    const view = this.view;
    if (!view) return;
    view.requestMeasure({
      read: () => {
        const number = Math.min(Math.max(1, Math.floor(line)), view.state.doc.lines);
        const block = view.lineBlockAt(view.state.doc.line(number).from);
        return block.top + (line - number) * block.height - this.scrolledHeight(view);
      },
      write: (by) => {
        view.scrollDOM.scrollTop += by;
      },
    });
  }

  private completionFor(offered: boolean): Extension {
    return offered ? markdownCompletion({ references: () => this.references() ?? [], people: () => this.people() ?? [] }) : [];
  }

  private create(path: string, numbered: boolean, readOnly: boolean) {
    this.view?.destroy();
    const value = untracked(this.value);
    const extensions: Extension[] = [
      this.separator.of(separatorFor(value)),
      ...editingSetup(numbered),
      readOnly ? EditorState.readOnly.of(true) : [],
      this.language.of([]),
      this.completion.of(this.completionFor(untracked(this.offersCompletion))),
      wordWrap(isProse(path)),
      isMarkdown(path) ? mathPreview((source, display) => this.typesetter.render(source, display)) : [],
      this.overview.of(untracked(this.showsMinimap) ? minimap() : []),
      EditorView.contentAttributes.of({ "aria-label": this.label(), spellcheck: isProse(path) ? "true" : "false" }),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (this.save.emit(), true) }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(reload)))
          this.valueChange.emit(update.state.sliceDoc());
      }),
    ];
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: this.host });
    this.view = view;
    view.scrollDOM.addEventListener("scroll", () => this.scrolled.emit(this.topLine()), { passive: true });
    void languageFor(path).then((support) => {
      if (support && this.view === view) view.dispatch({ effects: this.language.reconfigure(support) });
    });
  }
}
