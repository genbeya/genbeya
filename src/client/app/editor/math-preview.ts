/**
 * A preview of the formula the cursor is in, in Markdown: `$…$` and
 * `$$…$$` on a line, `$$` blocks and ```math fences. Finding the formula is
 * a light scan of the text, not a Markdown parse; the page renders with the
 * full rules (markdown/math-syntax.ts).
 */
import { type EditorState, StateField, type Text } from "@codemirror/state";
import { EditorView, showTooltip, type Tooltip } from "@codemirror/view";

export interface MathRange {
  readonly from: number;
  readonly to: number;
  readonly source: string;
  readonly display: boolean;
}

export type Typeset = (source: string, display: boolean) => Promise<{ readonly math: Element } | { readonly error: string }>;

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;
/** `$$…$$`, or `$…$` with the rules of the page: no space inside the dollars, no digit after. */
const INLINE = /\$\$(.+?)\$\$|\$(?=[^\s$`])((?:\\.|[^$\\])*?[^\s\\])\$(?!\d)/g;

/** Lines `first` to `last` of a document: a `$$` block or ```math fence, or "code" in other fenced code. */
interface Block {
  readonly first: number;
  readonly last: number;
  readonly block: MathRange | "code";
}

/** The blocks of each document, found once: the cursor and every completion ask. */
const indexed = new WeakMap<Text, readonly Block[]>();

/**
 * The `$$` blocks, ```math fences and other fenced code of `doc`, from the
 * top. Code runs from its opening line to the line before its closing one,
 * or to the end; math without its closing line is none.
 */
function blocksOf(doc: Text): readonly Block[] {
  const known = indexed.get(doc);
  if (known) return known;
  const blocks: Block[] = [];
  let fence: { marker: string; math: boolean; from: number; line: number } | null = null;
  let dollars: { from: number; line: number } | null = null;
  for (let number = 1; number <= doc.lines; number++) {
    const { text, from, to } = doc.line(number);
    const trimmed = text.trim();
    let closed: { from: number; line: number } | null = null;
    if (fence) {
      if (trimmed.startsWith(fence.marker) && !trimmed.slice(fence.marker.length).trim()) {
        if (fence.math) closed = fence;
        else blocks.push({ first: fence.line, last: number - 1, block: "code" });
        fence = null;
      }
    } else if (dollars !== null) {
      if (trimmed.endsWith("$$")) [closed, dollars] = [dollars, null];
    } else {
      const opening = FENCE.exec(text);
      if (opening) fence = { marker: opening[1]!, math: opening[2]!.toLowerCase() === "math", from, line: number };
      else if (trimmed.startsWith("$$") && (trimmed === "$$" || !trimmed.slice(2).includes("$$"))) dollars = { from, line: number };
    }
    if (closed !== null) {
      const body = doc.sliceString(closed.from, to).split("\n").slice(1, -1).join("\n");
      const first = doc.lineAt(closed.from).text.trim();
      const last = trimmed;
      // `$$ a` … `b $$` keep the text beside the dollars.
      const source = first.startsWith("$$") ? [first.slice(2), body, last.slice(0, -2)].filter((part) => part.trim()).join("\n") : body;
      blocks.push({ first: closed.line, last: number, block: { from: closed.from, to, source: source.trim(), display: true } });
    }
  }
  if (fence && !fence.math) blocks.push({ first: fence.line, last: doc.lines, block: "code" });
  indexed.set(doc, blocks);
  return blocks;
}

/** The `$$` block or ```math fence that `line` is in; "code" in other fenced code, where dollars are no math. */
function blockAt(doc: Text, line: number): MathRange | "code" | null {
  const blocks = blocksOf(doc);
  let [low, high] = [0, blocks.length - 1];
  while (low <= high) {
    const middle = (low + high) >> 1;
    const { first, last, block } = blocks[middle]!;
    if (line < first) high = middle - 1;
    else if (line > last) low = middle + 1;
    else return block;
  }
  return null;
}

export function mathAt(doc: Text, pos: number): MathRange | null {
  const line = doc.lineAt(pos);
  const block = blockAt(doc, line.number);
  if (block === "code") return null;
  if (block) return block.from <= pos && pos <= block.to ? block : null;
  for (const match of line.text.matchAll(INLINE)) {
    const from = line.from + match.index;
    const to = from + match[0].length;
    if (from <= pos && pos <= to) return { from, to, source: (match[1] ?? match[2]!).trim(), display: match[1] !== undefined };
  }
  return null;
}

/** The formula each tooltip shows. */
const shown = new WeakMap<Tooltip, string>();

function tooltipFor(state: EditorState, previous: Tooltip | null, typeset: Typeset): Tooltip | null {
  const selection = state.selection.main;
  const range = selection.empty ? mathAt(state.doc, selection.head) : null;
  if (!range?.source) return null;
  const key = `${range.display}:${range.source}`;
  const pos = range.display ? range.to : range.from;
  // Moving inside the same formula keeps its preview.
  if (previous && previous.pos === pos && shown.get(previous) === key) return previous;
  const tooltip: Tooltip = {
    pos,
    above: !range.display,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "cm-math-preview";
      void typeset(range.source, range.display).then((result) => {
        if ("math" in result) dom.replaceChildren(result.math);
        else {
          dom.classList.add("is-error");
          dom.textContent = result.error;
        }
      });
      return { dom };
    },
  };
  shown.set(tooltip, key);
  return tooltip;
}

const theme = EditorView.baseTheme({
  ".cm-tooltip .cm-math-preview": {
    display: "flex",
    maxWidth: "560px",
    padding: "8px 12px",
    overflowX: "auto",
    overflowY: "hidden",
    color: "var(--text)",
    fontSize: "15px",
  },
  ".cm-math-preview math": { fontFamily: '"Genbeya Math", math' },
  ".cm-math-preview.is-error": { color: "var(--red)", fontFamily: "var(--font-ui)", fontSize: "12px" },
});

/** Shows the formula under the cursor, typeset by `typeset`. */
export function mathPreview(typeset: Typeset) {
  const field = StateField.define<Tooltip | null>({
    create: (state) => tooltipFor(state, null, typeset),
    update: (tooltip, transaction) =>
      transaction.docChanged || transaction.selection ? tooltipFor(transaction.state, tooltip, typeset) : tooltip,
    provide: (self) => showTooltip.from(self),
  });
  return [field, theme];
}
