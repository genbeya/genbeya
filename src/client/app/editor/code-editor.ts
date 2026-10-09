/** An editable file: CodeMirror with the language of its path. */
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, untracked } from "@angular/core";
import { editingSetup, isProse, languageFor } from "./editor-setup";

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
      if (view && view.state.doc.toString() !== value) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    });
    inject(DestroyRef).onDestroy(() => this.view?.destroy());
  }

  focus(): void {
    this.view?.focus();
  }

  private create(path: string, numbered: boolean) {
    this.view?.destroy();
    const extensions: Extension[] = [
      ...editingSetup(numbered),
      this.language.of([]),
      ...(isProse(path) ? [EditorView.lineWrapping] : []),
      EditorView.contentAttributes.of({ "aria-label": this.label(), spellcheck: isProse(path) ? "true" : "false" }),
      keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (this.save.emit(), true) }]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) this.valueChange.emit(update.state.doc.toString());
      }),
    ];
    const view = new EditorView({ state: EditorState.create({ doc: untracked(this.value), extensions }), parent: this.host });
    this.view = view;
    if (this.autofocus()) view.focus();
    void languageFor(path).then((support) => {
      if (support && this.view === view) view.dispatch({ effects: this.language.reconfigure(support) });
    });
  }
}
