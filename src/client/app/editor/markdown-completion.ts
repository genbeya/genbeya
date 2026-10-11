/**
 * Completion while writing Markdown: `[[references]]`, `@mentions` of the
 * repository's people, dates after `//`, and blocks after `/` alone at the
 * start of a line, never inside code or URLs.
 */
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { Person } from "../../../contracts/model";
import { formatDate, today } from "../ui/calendar-date";
import { blockSource } from "./block-completion";
import { openDatePicker } from "./date-picker";
import { mathAt } from "./math-preview";
import { MENTION_TRIGGER, mentionSuggestions, mentionText } from "./mention-suggestions";
import { referenceSource, type ReferenceCandidate } from "./reference-completion";
import { DATE_TRIGGER, dateSuggestions } from "./smart-dates";

export interface MarkdownCandidates {
  readonly references: () => readonly ReferenceCandidate[];
  readonly people: () => readonly Person[];
  /** Today, `2026-10-11`; the computer's today unless given. */
  readonly today?: () => string;
}

/** Inside code, URLs, raw HTML or math, where `@` and `//` are what they are. */
function inCode(state: EditorState, pos: number): boolean {
  const inner = syntaxTree(state).resolveInner(pos, -1);
  for (let node: typeof inner | null = inner; node; node = node.parent) if (/Code|URL|Autolink|HTML|Comment/.test(node.name)) return true;
  return mathAt(state.doc, pos) !== null;
}

/** The match of `trigger` in the line before the cursor, outside code. */
function before(context: CompletionContext, trigger: RegExp): RegExpExecArray | null {
  const line = context.state.doc.lineAt(context.pos);
  const match = trigger.exec(context.state.sliceDoc(line.from, context.pos));
  return match && !inCode(context.state, context.pos) ? match : null;
}

export function mentionSource(people: () => readonly Person[]) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = before(context, MENTION_TRIGGER);
    if (!match) return null;
    const options = mentionSuggestions(people(), match[1]!).map((person): Completion => ({
      label: person.name,
      detail: `@${person.handle}`,
      info: person.email ?? undefined,
      type: "person",
      apply: (view, _completion, from, to) => {
        const insert = mentionText(person, view.state.sliceDoc(to, to + 1));
        view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
      },
    }));
    return options.length ? { from: context.pos - match[0].length, options, filter: false } : null;
  };
}

/** Replaces `from`–`to` with a date picked from the calendar, below `from`. */
function pickDate(view: EditorView, from: number, to: number, on: string) {
  const coords = view.coordsAtPos(from) ?? { left: 0, bottom: 0 };
  openDatePicker({
    at: { left: coords.left, top: coords.bottom + 4 },
    today: on,
    onPick: (date) => {
      view.dispatch({ changes: { from, to, insert: date }, selection: { anchor: from + date.length } });
      view.focus();
    },
    onCancel: () => view.focus(),
  });
}

export function dateSource(now: () => string = () => today()) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = before(context, DATE_TRIGGER);
    if (!match) return null;
    const on = now();
    const options = dateSuggestions(match[1]!, on).map(({ label, date }, index): Completion => ({
      label,
      detail: date && !label.includes(date.slice(0, 4)) ? formatDate(date, { weekday: true }) : undefined,
      type: "date",
      // Kept in the order given.
      boost: -index,
      apply: (view, _completion, from, to) => {
        if (date) view.dispatch({ changes: { from, to, insert: date }, selection: { anchor: from + date.length } });
        else pickDate(view, from, to, on);
      },
    }));
    return options.length ? { from: context.pos - match[0].length, options, filter: false } : null;
  };
}

/** Blocks to insert (block-completion.ts), but not in code blocks or math. */
export const markdownBlockSource = (context: CompletionContext): CompletionResult | null =>
  inCode(context.state, context.pos) ? null : blockSource(context);

/** `[[references]]` (reference-completion.ts), but not in code or math, where `[[` is what it is. */
export function markdownReferenceSource(candidates: () => readonly ReferenceCandidate[]) {
  const source = referenceSource(candidates);
  return (context: CompletionContext): CompletionResult | null => (inCode(context.state, context.pos) ? null : source(context));
}

export const markdownCompletion = (candidates: MarkdownCandidates): Extension =>
  autocompletion({
    override: [
      markdownReferenceSource(candidates.references),
      mentionSource(candidates.people),
      dateSource(candidates.today),
      markdownBlockSource,
    ],
    icons: true,
  });
