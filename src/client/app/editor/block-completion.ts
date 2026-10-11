/**
 * `/` at the start of a line in Markdown offers blocks to insert: math,
 * diagrams, callouts, tables, code, collapsible sections, footnotes. Only at
 * the start of a line, so `/` in text (paths, `//` for dates) is left alone.
 */
import { snippet, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";

interface Block {
  readonly label: string;
  readonly detail: string;
  /** A CodeMirror snippet: `#{name}` fields, Tab moves between them. */
  readonly template: string;
}

export const BLOCKS: readonly Block[] = [
  { label: "Math", detail: "$$", template: "$$\n#{x^2}\n$$" },
  { label: "Diagram", detail: "```mermaid", template: "```mermaid\nflowchart LR\n  #{A} --> #{B}\n```" },
  { label: "Callout", detail: "> [!NOTE]", template: "> [!#{NOTE}]\n> #{}" },
  { label: "Foldable callout", detail: "> [!TIP]-", template: "> [!#{TIP}]- #{Title}\n> #{}" },
  { label: "Table", detail: "| a | b |", template: "| #{Column} | #{Column} |\n| --- | --- |\n| #{} |  |" },
  { label: "Code", detail: "```ts", template: '```#{ts} title="#{file.ts}"\n#{}\n```' },
  { label: "Diff", detail: "```diff", template: "```diff\n- #{old}\n+ #{new}\n```" },
  { label: "Collapsible section", detail: "<details>", template: "<details>\n<summary>#{Summary}</summary>\n\n#{}\n\n</details>" },
  { label: "Footnote", detail: "[^1]:", template: "[^#{1}]: #{}" },
  { label: "Table of contents", detail: "[TOC]", template: "[TOC]" },
];

/** A `/` and the word typed after it, alone on the line so far. */
const COMMAND = /^\s*\/([\w-]*)$/;

export function blockSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const match = COMMAND.exec(context.state.sliceDoc(line.from, context.pos));
  if (!match) return null;
  const from = context.pos - match[1]!.length;
  const options = BLOCKS.map(({ label, detail, template }, index): Completion => ({
    label,
    detail,
    type: "keyword",
    // In the order above, not alphabetically.
    boost: -index,
    // The `/` goes too.
    apply: (view, completion, start, end) => snippet(template)(view, completion, start - 1, end),
  }));
  return { from, options, validFor: /^[\w-]*$/ };
}
