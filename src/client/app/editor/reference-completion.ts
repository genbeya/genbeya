/** Completes `[[references]]` in Markdown: tasks, wiki pages and files. */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";

export interface ReferenceCandidate {
  /** What goes between the brackets: a task ID, page title or file path. */
  readonly target: string;
  /** What the list shows and the typed text is matched against. */
  readonly label: string;
  readonly detail?: string;
  readonly kind: "task" | "page" | "file";
}

/** The text after an unclosed `[[` on the current line. */
const OPEN = /\[\[([^\]|\n]*)$/;
const ICON_TYPES: Readonly<Record<ReferenceCandidate["kind"], string>> = { task: "class", page: "text", file: "variable" };

export function referenceSource(candidates: () => readonly ReferenceCandidate[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const match = OPEN.exec(context.state.sliceDoc(line.from, context.pos));
    if (!match) return null;
    const from = context.pos - match[1]!.length;
    const options = candidates().map((candidate): Completion => ({
      label: candidate.label,
      detail: candidate.detail,
      type: ICON_TYPES[candidate.kind],
      apply: (view, _completion, start, end) => {
        // Closing brackets the editor already inserted are kept, not doubled.
        const closed = view.state.sliceDoc(end, end + 2) === "]]";
        const insert = closed ? candidate.target : `${candidate.target}]]`;
        view.dispatch({ changes: { from: start, to: end, insert }, selection: { anchor: start + insert.length + (closed ? 2 : 0) } });
      },
    }));
    return { from, options, validFor: /^[^\]|\n]*$/ };
  };
}

export const referenceCompletion = (candidates: () => readonly ReferenceCandidate[]): Extension =>
  autocompletion({ override: [referenceSource(candidates)], icons: true });
