/**
 * Two versions of a file, side by side or inline; unchanged stretches are
 * folded. With hunk actions, each changed chunk gets a bar with them, and
 * lines can be selected to act on just those.
 */
import { getChunks, getOriginalDoc, MergeView, unifiedMergeView } from "@codemirror/merge";
import { EditorSelection, EditorState, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, untracked } from "@angular/core";
import type { LineRange, LineSelection } from "../../../contracts/model";
import { languageFor, viewingSetup } from "./editor-setup";
import { chosenLines, chunkLines, selectedLines, wholeChunk } from "./line-selection";
import { lineStaging, type HunkAction } from "./line-staging";

export type { HunkAction } from "./line-staging";

const CONTEXT_LINES = 4;

/** A hunk action chosen on a chunk, with the chunk's lines. */
export interface HunkEvent {
  readonly action: string;
  readonly lines: LineSelection;
}

const sameSelection = (a: LineSelection | null, b: LineSelection | null) => JSON.stringify(a) === JSON.stringify(b);

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
  /** Actions on whole chunks; with any, lines can be selected too. */
  readonly hunkActions = input<readonly HunkAction[]>([]);
  readonly hunk = output<HunkEvent>();
  /** The changed lines selected; null when none are. */
  readonly lines = output<LineSelection | null>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private destroy: (() => void) | null = null;
  /** Counts renders, so a slow language load never shows an older diff. */
  private generation = 0;
  /** The editors showing the original (side by side only) and the modified version. */
  private editors: { a: EditorView | null; b: EditorView } | null = null;
  private chosen: LineSelection | null = null;

  constructor() {
    effect(() => {
      const [path, original, modified, inline, actions] = [
        this.path(),
        this.original(),
        this.modified(),
        this.inline(),
        this.hunkActions(),
      ];
      untracked(() => void this.show(path, original, modified, inline, actions));
    });
    inject(DestroyRef).onDestroy(() => {
      // A language still loading must not build a view after this.
      this.generation++;
      this.destroy?.();
    });
  }

  /** Forgets the selected lines, e.g. after acting on them. */
  clearSelection(): void {
    for (const view of [this.editors?.a, this.editors?.b])
      if (view && !view.state.selection.main.empty) view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) });
  }

  private async show(path: string, original: string, modified: string, inline: boolean, actions: readonly HunkAction[]) {
    const generation = ++this.generation;
    const language = await languageFor(path);
    if (generation !== this.generation) return;
    const extensions = [...viewingSetup(), ...(language ? [language] : [])];
    const staging = (bars: boolean, other: () => EditorView | null | undefined) =>
      actions.length
        ? lineStaging({
            actions,
            bars,
            act: (chunk, action) => this.act(chunk, action),
            pointer: (adding) => {
              const view = other();
              if (!adding && view && !view.state.selection.main.empty) view.dispatch({ selection: EditorSelection.cursor(0) });
            },
            selected: () => this.select(),
          })
        : [];
    this.destroy?.();
    this.editors = null;
    this.publish(null);
    if (inline) {
      const view = new EditorView({
        parent: this.host,
        state: EditorState.create({
          doc: modified,
          extensions: [
            ...extensions,
            unifiedMergeView({ original, mergeControls: false, collapseUnchanged: { margin: CONTEXT_LINES } }),
            staging(true, () => null),
          ],
        }),
      });
      this.editors = { a: null, b: view };
      this.destroy = () => view.destroy();
    } else {
      const view: MergeView = new MergeView({
        parent: this.host,
        a: { doc: original, extensions: [...extensions, staging(false, () => view.b)] },
        b: { doc: modified, extensions: [...extensions, staging(true, () => view.a)] },
        collapseUnchanged: { margin: CONTEXT_LINES },
        gutter: true,
      });
      this.editors = { a: view.a, b: view.b };
      this.destroy = () => view.destroy();
    }
  }

  /** The chunks with their lines in both versions. */
  private chunks() {
    const b = this.editors?.b;
    if (!b) return [];
    const a: Text = this.editors!.a?.state.doc ?? getOriginalDoc(b.state);
    return (getChunks(b.state)?.chunks ?? []).map((chunk) => chunkLines(chunk, a, b.state.doc));
  }

  private act(index: number, action: string) {
    const chunk = this.chunks()[index];
    if (chunk) this.hunk.emit({ action, lines: wholeChunk(chunk) });
  }

  private select() {
    const lines = (view: EditorView | null | undefined): LineRange[] =>
      view ? selectedLines(view.state.doc, view.state.selection.ranges) : [];
    this.publish(chosenLines(this.chunks(), lines(this.editors?.a), lines(this.editors?.b)));
  }

  private publish(selection: LineSelection | null) {
    if (sameSelection(selection, this.chosen)) return;
    this.chosen = selection;
    this.lines.emit(selection);
  }
}
