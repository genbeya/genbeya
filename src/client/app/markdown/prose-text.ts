/** Finding things in the prose of a Markdown tree: the text outside code, links and raw HTML. */
import type { Nodes, Parent, PhrasingContent, Root, Text } from "mdast";

/** Where a piece of text stands. */
export interface TextContext {
  /** The innermost list item's checkbox: true when ticked, false when open, null outside task lists. */
  readonly checked: boolean | null;
}

/** Nodes whose text is no prose, and stays as written. */
const LITERAL = new Set(["link", "linkReference", "inlineCode", "code", "html", "definition", "image", "imageReference"]);

/**
 * Replaces each match of `pattern` (global) in the prose of `tree` with the
 * node `replace` returns for it; matches it returns null for stay text.
 */
export function replaceInProse(
  tree: Root,
  pattern: RegExp,
  replace: (match: RegExpExecArray, context: TextContext) => PhrasingContent | null,
): void {
  const split = (node: Text, context: TextContext): PhrasingContent[] | null => {
    const parts: PhrasingContent[] = [];
    let last = 0;
    for (const match of node.value.matchAll(pattern)) {
      const replacement = replace(match, context);
      if (!replacement) continue;
      if (match.index > last) parts.push({ type: "text", value: node.value.slice(last, match.index) });
      parts.push(replacement);
      last = match.index + match[0].length;
    }
    if (!parts.length) return null;
    if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
    return parts;
  };
  const walk = (node: Nodes, context: TextContext) => {
    if (LITERAL.has(node.type) || !("children" in node)) return;
    const inner = node.type === "listItem" ? { checked: node.checked ?? null } : context;
    const parent = node as Parent;
    parent.children = parent.children.flatMap((child): Nodes[] => {
      if (child.type !== "text") {
        walk(child, inner);
        return [child];
      }
      return split(child, inner) ?? [child];
    }) as Parent["children"];
  };
  walk(tree, { checked: null });
}

/** A `span` with classes, other properties and text or children, for the DOM builder. */
export function inline(
  className: string,
  children: string | PhrasingContent[],
  properties: Readonly<Record<string, string>> = {},
): PhrasingContent {
  return {
    type: "emphasis",
    data: { hName: "span", hProperties: { className: className.split(" "), ...properties } },
    children: typeof children === "string" ? (children ? [{ type: "text", value: children }] : []) : children,
  };
}
