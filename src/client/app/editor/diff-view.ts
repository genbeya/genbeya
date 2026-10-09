/** Two versions of a file, side by side or inline; unchanged stretches are folded. */
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, untracked } from "@angular/core";
import { languageFor, viewingSetup } from "./editor-setup";

const CONTEXT_LINES = 4;

@Component({
  selector: "gd-diff-view",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "editor", role: "region", "[attr.aria-label]": "'Changes in ' + path()" },
  template: "",
  styles: `
    :host {
      display: block;
      flex: 1;
      min-height: 0;
      overflow: auto;
    }
    :host ::ng-deep .cm-mergeView,
    :host ::ng-deep .cm-mergeViewEditors {
      min-height: 100%;
    }
  `,
})
export class DiffView {
  readonly path = input.required<string>();
  readonly original = input.required<string>();
  readonly modified = input.required<string>();
  readonly inline = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private destroy: (() => void) | null = null;
  /** Counts renders, so a slow language load never shows an older diff. */
  private generation = 0;

  constructor() {
    effect(() => {
      const [path, original, modified, inline] = [this.path(), this.original(), this.modified(), this.inline()];
      untracked(() => void this.show(path, original, modified, inline));
    });
    inject(DestroyRef).onDestroy(() => this.destroy?.());
  }

  private async show(path: string, original: string, modified: string, inline: boolean) {
    const generation = ++this.generation;
    const language = await languageFor(path);
    if (generation !== this.generation) return;
    const extensions = [...viewingSetup(), ...(language ? [language] : [])];
    this.destroy?.();
    if (inline) {
      const view = new EditorView({
        parent: this.host,
        state: EditorState.create({
          doc: modified,
          extensions: [...extensions, unifiedMergeView({ original, mergeControls: false, collapseUnchanged: { margin: CONTEXT_LINES } })],
        }),
      });
      this.destroy = () => view.destroy();
    } else {
      const view = new MergeView({
        parent: this.host,
        a: { doc: original, extensions },
        b: { doc: modified, extensions },
        collapseUnchanged: { margin: CONTEXT_LINES },
        gutter: true,
      });
      this.destroy = () => view.destroy();
    }
  }
}
