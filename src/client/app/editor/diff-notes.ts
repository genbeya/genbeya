/**
 * Notes below lines of a diff's new version, such as the review threads of
 * a pull request beside the lines they are about.
 */
import { RangeSetBuilder, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

export interface DiffNote {
  /** The line of the new version the note goes below, from 1. */
  readonly line: number;
  readonly title: string;
  readonly text: string;
}

class NoteWidget extends WidgetType {
  constructor(private readonly notes: readonly DiffNote[]) {
    super();
  }

  override eq(other: NoteWidget): boolean {
    return JSON.stringify(other.notes) === JSON.stringify(this.notes);
  }

  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = "cm-diff-notes";
    for (const note of this.notes) {
      const item = document.createElement("div");
      item.className = "cm-diff-note";
      const title = document.createElement("strong");
      title.textContent = note.title;
      item.append(title);
      if (note.text) item.append(document.createTextNode(` ${note.text}`));
      box.append(item);
    }
    return box;
  }
}

function decorations(state: EditorState, notes: readonly DiffNote[]): DecorationSet {
  const byLine = new Map<number, DiffNote[]>();
  for (const note of notes)
    if (note.line >= 1 && note.line <= state.doc.lines) byLine.set(note.line, [...(byLine.get(note.line) ?? []), note]);
  const builder = new RangeSetBuilder<Decoration>();
  for (const line of [...byLine.keys()].sort((a, b) => a - b))
    builder.add(
      state.doc.line(line).to,
      state.doc.line(line).to,
      Decoration.widget({ widget: new NoteWidget(byLine.get(line)!), block: true, side: 1 }),
    );
  return builder.finish();
}

const theme = EditorView.baseTheme({
  ".cm-diff-notes": { padding: "4px 10px 6px 40px", fontFamily: "var(--font-ui)", fontSize: "12.5px", whiteSpace: "normal" },
  ".cm-diff-note": {
    padding: "5px 9px",
    margin: "2px 0",
    borderLeft: "3px solid var(--accent)",
    borderRadius: "4px",
    background: "var(--accent-soft)",
    color: "var(--text)",
  },
});

/** The notes, each below its line; notes for lines the document doesn't have are left out. */
export function diffNotes(notes: readonly DiffNote[]): Extension {
  if (!notes.length) return [];
  return [
    StateField.define<DecorationSet>({
      create: (state) => decorations(state, notes),
      update: (value, transaction) => (transaction.docChanged ? decorations(transaction.state, notes) : value),
      provide: (field) => EditorView.decorations.from(field),
    }),
    theme,
  ];
}
