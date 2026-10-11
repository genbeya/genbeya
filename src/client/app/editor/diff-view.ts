/**
 * Two versions of a file, side by side or inline; unchanged stretches are
 * folded. With git's changes, the chunks are where git has them. With hunk
 * actions, each changed chunk gets a bar with them, and lines can be
 * selected to act on just those. Showing a new version of the diff keeps
 * the scroll position and the stretches the user unfolded.
 */
import { getChunks, getOriginalDoc, MergeView, uncollapseUnchanged, unifiedMergeView, type Chunk } from "@codemirror/merge";
import { EditorSelection, EditorState, Text, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, untracked } from "@angular/core";
import type { Diff, LineRange, LineSelection } from "../../../contracts/model";
import { languageFor, viewingSetup } from "./editor-setup";
import { GitChanges } from "./git-changes";
import { chosenLines, chunkLines, selectedLines, wholeChunk, type ChunkLines } from "./line-selection";
import { lineStaging, type HunkAction } from "./line-staging";

export type { HunkAction } from "./line-staging";

const CONTEXT_LINES = 4;

/** What the merge view's folded stretches are (see `CollapseWidget` in @codemirror/merge). */
const COLLAPSED = "collapsed-unchanged-code";

/** Lines of the diff with the version they were chosen in, which may be newer than the one the caller last loaded. */
export interface DiffLines {
  readonly lines: LineSelection;
  readonly version: string;
}

/** A hunk action chosen on a chunk, with the chunk's lines. */
export interface HunkEvent extends DiffLines {
  readonly action: string;
}

/** The parts of a diff the view shows. */
export type ShownDiff = Pick<Diff, "original" | "modified" | "version" | "changes">;

const sameSelection = (a: DiffLines | null, b: DiffLines | null) => JSON.stringify(a) === JSON.stringify(b);

/** The folded stretches of an editor, by position. */
function folded(state: EditorState): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (const source of state.facet(EditorView.decorations))
    if (typeof source !== "function")
      source.between(0, state.doc.length, (from, to, decoration) => {
        if ((decoration.spec.widget as { type?: string } | undefined)?.type === COLLAPSED) ranges.push({ from, to });
      });
  return ranges;
}

/** The lines `from` to `to` cover. */
const linesOf = (doc: Text, from: number, to: number): LineRange => ({ from: doc.lineAt(from).number, to: doc.lineAt(to).number });

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
  readonly diff = input.required<ShownDiff>();
  readonly inline = input(false);
  /** Actions on whole chunks; with any, lines can be selected too. */
  readonly hunkActions = input<readonly HunkAction[]>([]);
  readonly hunk = output<HunkEvent>();
  /** The changed lines selected; null when none are. */
  readonly lines = output<DiffLines | null>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private destroy: (() => void) | null = null;
  /** Counts renders, so a slow language load never shows an older diff. */
  private generation = 0;
  /** What is shown: the editors (the original only side by side), the diff's version, and git's changes. */
  private shown: { a: EditorView | null; b: EditorView; path: string; version: string; git: GitChanges | null } | null = null;
  private chosen: DiffLines | null = null;
  /** Unchanged stretches the user unfolded, by their lines in each version; kept while the same file is shown. */
  private unfolded: { a: LineRange[]; b: LineRange[] } = { a: [], b: [] };
  private runs: { chunks: readonly Chunk[]; runs: ChunkLines[][] } | null = null;

  constructor() {
    effect(() => {
      const [path, diff, inline, actions] = [this.path(), this.diff(), this.inline(), this.hunkActions()];
      untracked(() => void this.show(path, diff, inline, actions));
    });
    inject(DestroyRef).onDestroy(() => {
      // A language still loading must not build a view after this.
      this.generation++;
      this.destroy?.();
    });
  }

  /** Forgets the selected lines, e.g. after acting on them. */
  clearSelection(): void {
    for (const view of [this.shown?.a, this.shown?.b])
      if (view && !view.state.selection.main.empty) view.dispatch({ selection: EditorSelection.cursor(view.state.selection.main.head) });
  }

  private async show(path: string, diff: ShownDiff, inline: boolean, actions: readonly HunkAction[]) {
    const generation = ++this.generation;
    const language = await languageFor(path);
    if (generation !== this.generation) return;
    const { original, modified, version } = diff;
    const git = diff.changes ? new GitChanges(diff.changes, original, modified) : null;
    const extensions = [...viewingSetup(), ...(language ? [language] : [])];
    const staging = (side: "a" | "b", bars: boolean, other: () => EditorView | null | undefined): Extension => [
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
        : [],
      this.remembering(side),
    ];
    const same = this.shown?.path === path;
    const scrolled = same ? this.host.scrollTop : 0;
    if (!same) this.unfolded = { a: [], b: [] };
    this.destroy?.();
    this.shown = null;
    this.runs = null;
    this.publish(null);
    // Split as the editor splits lines, lone carriage returns included.
    const originalDoc = Text.of(original.split(/\r\n?|\n/));
    if (inline) {
      const view = new EditorView({
        parent: this.host,
        state: EditorState.create({
          doc: modified,
          extensions: [
            ...extensions,
            unifiedMergeView({
              original: originalDoc,
              mergeControls: false,
              collapseUnchanged: { margin: CONTEXT_LINES },
              ...(git ? { diffConfig: git.config } : {}),
            }),
            staging("b", true, () => null),
          ],
        }),
      });
      this.shown = { a: null, b: view, path, version, git };
      this.destroy = () => view.destroy();
    } else {
      const view: MergeView = new MergeView({
        parent: this.host,
        a: { doc: originalDoc, extensions: [...extensions, staging("a", false, () => view.b)] },
        b: { doc: modified, extensions: [...extensions, staging("b", true, () => view.a)] },
        collapseUnchanged: { margin: CONTEXT_LINES },
        gutter: true,
        ...(git ? { diffConfig: git.config } : {}),
      });
      this.shown = { a: view.a, b: view.b, path, version, git };
      this.destroy = () => view.destroy();
    }
    this.unfold();
    if (scrolled) {
      this.host.scrollTop = scrolled;
      // Again once the editors have measured their lines.
      requestAnimationFrame(() => {
        if (generation === this.generation) this.host.scrollTop = scrolled;
      });
    }
  }

  /** Records the stretches the user unfolds in the editor of `side`. */
  private remembering(side: "a" | "b"): Extension {
    return EditorView.updateListener.of((update) => {
      for (const transaction of update.transactions)
        for (const effect of transaction.effects)
          if (effect.is(uncollapseUnchanged)) {
            const stretch = folded(transaction.startState).find((range) => range.from === effect.value);
            const lines = stretch && linesOf(transaction.startState.doc, stretch.from, stretch.to);
            const known = this.unfolded[side].some((range) => range.from === lines?.from && range.to === lines.to);
            if (lines && !known) this.unfolded[side].push(lines);
          }
    });
  }

  /** Unfolds the stretches that overlap ones the user unfolded in the previous version of the diff. */
  private unfold() {
    for (const side of ["a", "b"] as const) {
      const view = this.shown?.[side];
      const unfolded = this.unfolded[side];
      if (!view || !unfolded.length) continue;
      const effects = folded(view.state)
        .filter(({ from, to }) => {
          const lines = linesOf(view.state.doc, from, to);
          return unfolded.some((range) => range.from <= lines.to && lines.from <= range.to);
        })
        .map(({ from }) => uncollapseUnchanged.of(from));
      if (effects.length) view.dispatch({ effects });
    }
  }

  /** Git's runs in each chunk shown; without git's changes, the chunks themselves. */
  private chunkRuns(): ChunkLines[][] {
    const shown = this.shown;
    if (!shown) return [];
    const chunks = getChunks(shown.b.state)?.chunks ?? [];
    if (this.runs?.chunks === chunks) return this.runs.runs;
    const a: Text = shown.a?.state.doc ?? getOriginalDoc(shown.b.state);
    const runs = shown.git ? shown.git.runsIn(chunks) : chunks.map((chunk) => [chunkLines(chunk, a, shown.b.state.doc)]);
    this.runs = { chunks, runs };
    return runs;
  }

  private act(index: number, action: string) {
    const runs = this.chunkRuns()[index];
    if (!runs?.length || !this.shown) return;
    const whole = runs.map(wholeChunk);
    this.hunk.emit({
      action,
      lines: { original: whole.flatMap((lines) => lines.original), modified: whole.flatMap((lines) => lines.modified) },
      version: this.shown.version,
    });
  }

  private select() {
    const shown = this.shown;
    if (!shown) return;
    const lines = (view: EditorView | null, git: GitChanges["a"] | undefined): LineRange[] => {
      if (!view) return [];
      const selected = selectedLines(view.state.doc, view.state.selection.ranges);
      return git ? git.lines(view.state.doc, selected) : selected;
    };
    const chosen = chosenLines(this.chunkRuns().flat(), lines(shown.a, shown.git?.a), lines(shown.b, shown.git?.b));
    this.publish(chosen && { lines: chosen, version: shown.version });
  }

  private publish(selection: DiffLines | null) {
    if (sameSelection(selection, this.chosen)) return;
    this.chosen = selection;
    this.lines.emit(selection);
  }
}
