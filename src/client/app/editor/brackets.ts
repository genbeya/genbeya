/**
 * Brackets: the pair at the cursor is outlined (a bracket without a partner
 * in red), and pairs are coloured by depth like VS Code's bracket pair
 * colourisation. Depth comes from the syntax tree and only visible lines
 * are coloured, so large files cost nothing extra.
 */
import { bracketMatching, syntaxTree } from "@codemirror/language";
import { type Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/** Colours cycle through this many depths. */
const COLOURS = 3;
/** Brackets that open a node come first among its children; later ones are not looked for. */
const LEADING_CHILDREN = 16;
const marks = Array.from({ length: COLOURS }, (_, depth) => Decoration.mark({ class: `cm-bracket-${depth}` }));

const isOpening = (name: string) => name === "(" || name === "[" || name === "{";
const isClosing = (name: string) => name === ")" || name === "]" || name === "}";

/** How many of `node`'s brackets are open at `position`. */
function openAt(node: SyntaxNode, position: number): number {
  const cursor = node.cursor();
  let open = 0;
  if (!cursor.firstChild()) return 0;
  for (let child = 0; child < LEADING_CHILDREN && cursor.to <= position; child++) {
    if (isOpening(cursor.name)) open++;
    else if (isClosing(cursor.name)) open = Math.max(0, open - 1);
    if (!cursor.nextSibling()) break;
  }
  return open;
}

/** How many bracket pairs enclose the pair `bracket` belongs to. */
export function bracketDepth(bracket: SyntaxNode): number {
  // A closing bracket's own partner is open before it.
  let depth = isClosing(bracket.name) ? -1 : 0;
  for (let node = bracket.parent; node; node = node.parent) depth += openAt(node, bracket.from);
  return Math.max(0, depth);
}

function colour(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  for (const { from, to } of view.visibleRanges)
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (isOpening(node.name) || isClosing(node.name)) builder.add(node.from, node.to, marks[bracketDepth(node.node) % COLOURS]!);
      },
    });
  return builder.finish();
}

const pairColours = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = colour(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || syntaxTree(update.state) !== syntaxTree(update.startState))
        this.decorations = colour(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const theme = EditorView.theme({
  ".cm-bracket-0": { color: "var(--yellow)" },
  ".cm-bracket-1": { color: "var(--purple)" },
  ".cm-bracket-2": { color: "var(--blue)" },
  "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
    backgroundColor: "var(--accent-soft)",
    outline: "1px solid color-mix(in srgb, var(--accent) 70%, transparent)",
    borderRadius: "2px",
  },
  "&.cm-focused .cm-nonmatchingBracket, .cm-nonmatchingBracket": {
    backgroundColor: "var(--red-soft)",
    outline: "1px solid var(--red)",
    borderRadius: "2px",
    color: "var(--red)",
  },
});

export function brackets(): Extension {
  return [bracketMatching(), pairColours, theme];
}
