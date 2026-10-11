/**
 * The few raw HTML tags GitHub documents use that pages render too:
 * `<kbd>`, `<sub>` and `<sup>` around text, `<br>`, and `<details>` with a
 * `<summary>` around Markdown. Only these exact tags become elements, never
 * with attributes (`<details>` may say `open`); the text of a summary is
 * kept as text. All other HTML is dropped later, as before.
 */
import type { Blockquote, Html, Nodes, Paragraph, Parents, PhrasingContent, Root, RootContent } from "mdast";
import { decodeString } from "micromark-util-decode-string";
import type { Processor } from "unified";
import { visit } from "unist-util-visit";

const INLINE = /^<(kbd|sub|sup)>$/i;
const BREAK = /^<br\s*\/?>$/i;
const DETAILS = /^<details(\s+open(?:=(?:""|''|"open"))?)?\s*>\s*(?:<summary>([\s\S]*?)<\/summary>)?([\s\S]*)$/i;
const SUMMARY = /^<summary>([\s\S]*?)<\/summary>\s*$/i;
const CLOSING = /^([\s\S]*?)<\/details>\s*$/i;

const isHtml = (node: Nodes | undefined, pattern: RegExp): node is Html => node?.type === "html" && pattern.test(node.value.trim());

/** `<kbd>Ctrl</kbd>`: a pair of tags among siblings with no other HTML between them. */
function inlineTags(tree: Root) {
  visit(tree, (node) => {
    if (!("children" in node)) return;
    const children = node.children as PhrasingContent[];
    for (let index = 0; index < children.length; index++) {
      const child = children[index]!;
      if (child.type !== "html") continue;
      if (BREAK.test(child.value.trim())) {
        children[index] = { type: "break" };
        continue;
      }
      const tag = INLINE.exec(child.value.trim())?.[1]?.toLowerCase();
      if (!tag) continue;
      const end = children.findIndex((other, at) => at > index && other.type === "html");
      if (end < 0 || children[end]!.type !== "html" || (children[end] as Html).value.trim().toLowerCase() !== `</${tag}>`) continue;
      const element: PhrasingContent = { type: "emphasis", data: { hName: tag }, children: children.slice(index + 1, end) };
      children.splice(index, end - index + 1, element);
    }
  });
}

/** Summary text without tags, with entities decoded. */
const summaryText = (html: string): string =>
  decodeString(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim() || "Details";

/** Raw text inside the tags (no blank line around it) is Markdown too; it has no positions, so its checkboxes stay read-only. */
function parseInner(processor: Processor, markdown: string): RootContent[] {
  if (!markdown.trim()) return [];
  const tree = processor.parse(markdown) as Root;
  visit(tree, (node) => {
    delete node.position;
  });
  allDetails(processor, tree);
  return tree.children;
}

/** `<details>` … `</details>` among the children of `parent`, innermost first. */
function details(processor: Processor, parent: Parents) {
  const children = parent.children as RootContent[];
  for (let index = children.length - 1; index >= 0; index--) {
    const start = children[index]!;
    if (start.type !== "html") continue;
    const opening = DETAILS.exec(start.value.trim());
    // A summary with attributes is no summary: the section stays raw HTML.
    if (!opening || /<summary/i.test(opening[3] ?? "")) continue;
    let summary = opening[2];
    const rest = opening[3] ?? "";
    let first = index + 1;
    if (summary === undefined && !rest.trim() && isHtml(children[first], /^<summary/i)) {
      const own = SUMMARY.exec((children[first] as Html).value.trim());
      if (!own) continue;
      summary = own[1];
      first++;
    }
    let content: RootContent[];
    let end: number;
    const closedInside = CLOSING.exec(rest);
    if (closedInside && !/<details/i.test(closedInside[1]!)) {
      content = parseInner(processor, closedInside[1]!);
      end = index;
    } else {
      end = children.findIndex((node, at) => at >= first && isHtml(node, CLOSING));
      if (end < 0) continue;
      const tail = CLOSING.exec((children[end] as Html).value.trim())![1]!;
      content = [...parseInner(processor, rest), ...children.slice(first, end), ...parseInner(processor, tail)];
    }
    const title: Paragraph = {
      type: "paragraph",
      data: { hName: "summary" },
      children: [{ type: "text", value: summaryText(summary ?? "") }],
    };
    const element: Blockquote = {
      type: "blockquote",
      data: { hName: "details", hProperties: { className: ["md-details"], open: opening[1] ? true : undefined } },
      children: [title, ...(content as Blockquote["children"])],
    };
    children.splice(index, end - index + 1, element);
  }
}

function allDetails(processor: Processor, tree: Root) {
  const parents: Parents[] = [];
  visit(tree, (node) => {
    if ("children" in node) parents.push(node as Parents);
  });
  // Children before parents: a section inside a list or quote closes there.
  for (const parent of parents.reverse()) details(processor, parent);
}

export function remarkRawHtml(this: Processor) {
  return (tree: Root) => {
    allDetails(this, tree);
    inlineTags(tree);
  };
}
