/**
 * Callouts: GitHub's alerts (`> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]`, `[!CAUTION]`) and Obsidian's additions: a title after the
 * marker (`> [!WARNING] Mind the gap`), `-` to start folded and `+` to start
 * open (`> [!NOTE]-`), and more kinds, each in the style of the alert
 * closest to it.
 */
import type { Blockquote, Paragraph, PhrasingContent, Root } from "mdast";
import { visit } from "unist-util-visit";

/** Each kind and the alert whose style it uses. */
const STYLES: Readonly<Record<string, string>> = {
  note: "note",
  info: "note",
  todo: "note",
  abstract: "note",
  summary: "note",
  tldr: "note",
  quote: "note",
  cite: "note",
  tip: "tip",
  hint: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  important: "important",
  example: "important",
  question: "important",
  help: "important",
  faq: "important",
  warning: "warning",
  attention: "warning",
  caution: "caution",
  danger: "caution",
  error: "caution",
  bug: "caution",
  failure: "caution",
  fail: "caution",
  missing: "caution",
};
const MARKER = /^\[!(\w+)\]([+-]?)[ \t]*/;

/** Takes the rest of the first line off the paragraph: the title. */
function takeTitle(paragraph: Paragraph): PhrasingContent[] {
  const title: PhrasingContent[] = [];
  while (paragraph.children.length) {
    const child = paragraph.children[0]!;
    if (child.type === "break") {
      paragraph.children.shift();
      break;
    }
    if (child.type === "text" && child.value.includes("\n")) {
      const end = child.value.indexOf("\n");
      if (end) title.push({ type: "text", value: child.value.slice(0, end) });
      child.value = child.value.slice(end + 1);
      if (!child.value) paragraph.children.shift();
      break;
    }
    title.push(paragraph.children.shift()!);
  }
  const last = title.at(-1);
  if (last?.type === "text") last.value = last.value.trimEnd();
  return title.filter((node) => node.type !== "text" || node.value);
}

export function remarkCallouts() {
  return (tree: Root) => {
    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      // Blockquotes that already became something else (`<details>`) stay as they are.
      if (node.data?.hName || first?.type !== "paragraph" || first.children[0]?.type !== "text") return;
      const text = first.children[0];
      const match = MARKER.exec(text.value);
      const kind = match?.[1]!.toLowerCase();
      const style = kind && STYLES[kind];
      if (!match || !kind || !style) return;
      text.value = text.value.slice(match[0].length);
      if (!text.value) first.children.shift();
      const custom = takeTitle(first);
      if (!first.children.length) node.children.shift();
      const foldable = match[2] !== "";
      const title: Paragraph = {
        type: "paragraph",
        data: {
          hName: foldable ? "summary" : "p",
          hProperties: { className: custom.length ? ["callout-title"] : ["callout-title", "is-default"] },
        },
        children: custom.length ? custom : [{ type: "text", value: kind[0]!.toUpperCase() + kind.slice(1) }],
      };
      node.children.unshift(title);
      node.data = {
        ...node.data,
        hName: foldable ? "details" : "blockquote",
        hProperties: { className: ["callout", `callout-${style}`], dataCallout: kind, open: match[2] === "+" || undefined },
      };
    });
  };
}
