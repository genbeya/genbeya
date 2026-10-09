/** An editable file: CodeMirror with the language of its path. */
import { Annotation, Compartment, EditorState, type Extension, Transaction } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  untracked,
} from "@angular/core";
import { editingSetup, isProse, languageFor } from "./editor-setup";

const CRLF = String.fromCharCode(13, 10);
/** Files keep their line endings: CodeMirror would otherwise turn CRLF into LF. */
const separatorFor = (value: string): Extension => (value.includes(CRLF) ? EditorState.lineSeparator.of(CRLF) : []);
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
  readonly valueChange = output<string>();
  /** Ctrl+S (Cmd+S) inside the editor. */
  readonly save = output();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly language = new Compartment();
  private readonly separator = new Compartment();
  private view: EditorView | null = null;

  constructor() {
    effect(() => {
      const path = this.path();
      const numbered = this.lineNumbers();
      untracked(() => this.create(path, numbered));
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
    // Focus needs the editor in the document.
    afterNextRender(() => {
      if (this.autofocus()) this.view?.focus();
    });
    inject(DestroyRef).onDestroy(() => this.view?.destroy());
  }

  private create(path: string, numbered: boolean) {
    this.view?.destroy();
    const value = untracked(this.value);
    const extensions: Extension[] = [
      this.separator.of(separatorFor(value)),
      ...editingSetup(numbered),
      this.language.of([]),
      ...(isProse(path) ? [EditorView.lineWrapping] : []),
      EditorView.contentAttributes.of({ "aria-label": this.label(), spellcheck: isProse(path) ? "true" : "false" }),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (this.save.emit(), true) }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(reload)))
          this.valueChange.emit(update.state.sliceDoc());
      }),
    ];
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: this.host });
    this.view = view;
    void languageFor(path).then((support) => {
      if (support && this.view === view) view.dispatch({ effects: this.language.reconfigure(support) });
    });
  }
}
