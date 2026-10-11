/**
 * LaTeX math as GitHub writes it: `$…$` and `` $`…`$ `` in text, `$$…$$`
 * (display when alone in its paragraph), `$$` blocks and ```math fences.
 * Formulas become `.md-math` placeholders that the view typesets.
 */
import type { Code, InlineCode, Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { mathFromMarkdown, type InlineMath, type Math as MathBlock } from "mdast-util-math";
import type { Processor, Transformer } from "unified";
import { SKIP, visit } from "unist-util-visit";
import { mathSyntax } from "./math-syntax";

const formula = (node: MathBlock | InlineMath, display: boolean) => {
  node.data = {
    hName: display ? "div" : "span",
    hProperties: { className: display ? ["md-math", "is-display"] : ["md-math"] },
    hChildren: [{ type: "text", value: node.value }],
  };
};

const displayMath = (value: string): MathBlock => {
  const node: MathBlock = { type: "math", value };
  formula(node, true);
  return node;
};

/** `` $`a`$ ``: a code span between dollar signs. */
function codeSpanMath(tree: Root) {
  visit(tree, "inlineCode", (node: InlineCode, index, parent) => {
    if (!parent || index === undefined) return;
    const before = parent.children[index - 1];
    const after = parent.children[index + 1];
    if (before?.type !== "text" || after?.type !== "text" || !before.value.endsWith("$") || !after.value.startsWith("$")) return;
    before.value = before.value.slice(0, -1);
    after.value = after.value.slice(1);
    const math: InlineMath = { type: "inlineMath", value: node.value, position: node.position };
    formula(math, false);
    (parent.children as PhrasingContent[]).splice(index, 1, math);
    return [SKIP, index + 1];
  });
}

export function remarkMath(this: Processor): Transformer<Root> {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(...mathSyntax());
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());

  return (tree, file) => {
    const source = String(file);
    codeSpanMath(tree);
    visit(tree, (node, index, parent) => {
      if (!parent || index === undefined) return;
      let replacement: RootContent | null = null;
      if (node.type === "math") formula(node, true);
      else if (node.type === "inlineMath") formula(node, false);
      else if (node.type === "code" && (node as Code).lang?.toLowerCase() === "math") replacement = displayMath((node as Code).value);
      else if (node.type === "paragraph") {
        // `$$x$$` alone in a paragraph is shown as a block, as on GitHub.
        const only = (node as Paragraph).children.length === 1 ? (node as Paragraph).children[0] : undefined;
        const at = only?.position?.start.offset;
        if (only?.type === "inlineMath" && at !== undefined && source.startsWith("$$", at)) replacement = displayMath(only.value);
      }
      if (!replacement) return;
      (parent.children as RootContent[]).splice(index, 1, replacement);
      return [SKIP, index + 1];
    });
  };
}
