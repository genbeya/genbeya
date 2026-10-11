/**
 * Acting on parts of a diff: a bar with the hunk actions above each changed
 * chunk, and selecting lines by their numbers. A click on a line number
 * selects the line, Shift extends the selection from the last one, and the
 * keyboard selects as in any editor (Shift with the arrows); the editor
 * stays read-only.
 */
import { standardKeymap } from "@codemirror/commands";
import { getChunks } from "@codemirror/merge";
import { EditorSelection, EditorState, Prec, StateField, type Extension, type Line, type Range } from "@codemirror/state";
import { BlockType, Decoration, EditorView, keymap, ViewPlugin, WidgetType, type DecorationSet } from "@codemirror/view";

/** An action on a whole chunk, such as "Stage hunk". */
export interface HunkAction {
  readonly id: string;
  readonly label: string;
  readonly danger?: boolean;
}

export interface LineStaging {
  readonly actions: readonly HunkAction[];
  /** Whether this editor shows the hunk bars: the modified side, or the unified view. */
  readonly bars: boolean;
  /** Runs action `action` on chunk `chunk`. */
  readonly act: (chunk: number, action: string) => void;
  /** The user starts selecting in this editor; `adding` (Ctrl or Cmd) keeps the other editor's selection. */
  readonly pointer: (adding: boolean) => void;
  /** The editor's selection changed. */
  readonly selected: (view: EditorView) => void;
}

class HunkBar extends WidgetType {
  constructor(
    private readonly index: number,
    private readonly count: number,
    private readonly staging: LineStaging,
  ) {
    super();
  }

  override eq(other: HunkBar): boolean {
    return other.index === this.index && other.count === this.count;
  }

  toDOM(): HTMLElement {
    const bar = document.createElement("div");
    bar.className = "cm-hunkBar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", `Change ${this.index + 1} of ${this.count}`);
    const label = bar.appendChild(document.createElement("span"));
    label.className = "cm-hunkLabel";
    label.textContent = `Change ${this.index + 1} of ${this.count}`;
    for (const action of this.staging.actions) {
      const button = bar.appendChild(document.createElement("button"));
      button.type = "button";
      button.className = action.danger ? "cm-hunkButton is-danger" : "cm-hunkButton";
      button.textContent = action.label;
      button.addEventListener("click", () => this.staging.act(this.index, action.id));
    }
    return bar;
  }

  override ignoreEvent(): boolean {
    return true;
  }
}

function bars(state: EditorState, staging: LineStaging): DecorationSet {
  const chunks = getChunks(state)?.chunks ?? [];
  const ranges: Range<Decoration>[] = chunks.map((chunk, index) =>
    Decoration.widget({ widget: new HunkBar(index, chunks.length, staging), block: true, side: -2 }).range(
      state.doc.lineAt(Math.min(chunk.fromB, state.doc.length)).from,
    ),
  );
  return Decoration.set(ranges, true);
}

/**
 * The lines a click at `height` stands for: the line there, or, next to
 * what stands above a chunk's lines (its bar, and inline its removed
 * lines), the lines the chunk adds, which bring the removed ones along.
 */
function clickedLines(view: EditorView, height: number): [Line, Line] {
  const block = view.lineBlockAtHeight(height);
  const doc = view.state.doc;
  const line = doc.lineAt(block.from);
  const part = Array.isArray(block.type) ? block.type.find((sub) => sub.top <= height && height < sub.bottom) : null;
  if (!part || part.type === BlockType.Text) return [line, line];
  const chunk = getChunks(view.state)?.chunks.find((candidate) => doc.lineAt(Math.min(candidate.fromB, doc.length)).from === line.from);
  return chunk && chunk.toB > chunk.fromB ? [doc.lineAt(chunk.fromB), doc.lineAt(chunk.endB)] : [line, line];
}

/** Selects whole lines from the clicked line number, or from the anchor's line with Shift. */
function gutterClick(view: EditorView, event: MouseEvent): void {
  if (event.button !== 0 || !(event.target as Element).closest(".cm-gutters")) return;
  const doc = view.state.doc;
  const [from, to] = clickedLines(view, event.clientY - view.documentTop);
  const anchorLine = event.shiftKey ? doc.lineAt(view.state.selection.main.anchor) : from;
  const clicked = event.shiftKey && anchorLine.number > to.number ? from : to;
  const [first, last] = anchorLine.number <= clicked.number ? [anchorLine, clicked] : [clicked, anchorLine];
  const end = Math.min(last.to + 1, doc.length);
  // Selecting downwards keeps the first line as the anchor of the next Shift+click.
  const range = anchorLine.number <= clicked.number ? EditorSelection.range(first.from, end) : EditorSelection.range(end, first.from);
  view.dispatch({ selection: EditorSelection.create([range]), userEvent: "select.pointer" });
  view.focus();
  event.preventDefault();
}

export function lineStaging(staging: LineStaging): Extension[] {
  const field = StateField.define<DecorationSet>({
    create: (state) => bars(state, staging),
    update: (value, transaction) =>
      getChunks(transaction.state)?.chunks !== getChunks(transaction.startState)?.chunks ? bars(transaction.state, staging) : value,
    provide: (self) => EditorView.decorations.from(self),
  });
  return [
    ...(staging.bars && staging.actions.length ? [field] : []),
    // Focusable and selectable by keyboard, but never edited; overrides the viewing setup.
    Prec.highest(EditorView.editable.of(true)),
    EditorState.readOnly.of(true),
    keymap.of(standardKeymap),
    // On the whole editor: content handlers would miss the gutters.
    ViewPlugin.define((view) => {
      const pressed = (event: MouseEvent) => {
        if ((event.target as Element).closest(".cm-hunkBar")) return;
        staging.pointer(event.ctrlKey || event.metaKey);
        gutterClick(view, event);
      };
      view.dom.addEventListener("mousedown", pressed);
      return { destroy: () => view.dom.removeEventListener("mousedown", pressed) };
    }),
    EditorView.updateListener.of((update) => {
      if (update.selectionSet) staging.selected(update.view);
    }),
  ];
}
