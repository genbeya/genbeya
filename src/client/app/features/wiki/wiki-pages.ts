/** Page lookups over the wiki tree, shared by the wiki, links and the palette. */
import type { WikiNode } from "../../../../contracts/model";
import type { PageRef } from "../../markdown/markdown-pipeline";

/** Path of a page relative to the wiki folder, without `.md`. */
export const pageName = (path: string, root: string): string => path.slice(root.length + 1).replace(/\.md$/i, "");

/** Identifies a node: its page, or its folder when it has no page. */
export const nodeKey = (node: WikiNode): string => node.path ?? `folder:${node.folder}`;

/** The node of a page or folder path, with the nodes above it. */
export function findPage(nodes: readonly WikiNode[], path: string): { node: WikiNode; trail: WikiNode[] } | null {
  for (const node of nodes) {
    if (node.path === path || (node.folder && node.folder === path)) return { node, trail: [] };
    const inner = findPage(node.children, path);
    if (inner) return { node: inner.node, trail: [node, ...inner.trail] };
  }
  return null;
}

export const flattenPages = (nodes: readonly WikiNode[]): { title: string; path: string; trail: string[] }[] => {
  const walk = (level: readonly WikiNode[], trail: string[]): { title: string; path: string; trail: string[] }[] =>
    level.flatMap((node) => [...(node.path ? [{ title: node.title, path: node.path, trail }] : []), ...walk(node.children, [...trail, node.title])]);
  return walk(nodes, []);
};

/** The pages below a node, for `[SUBPAGES]`. */
export const subpagesOf = (nodes: readonly WikiNode[]): PageRef[] =>
  nodes.map((node) => ({ title: node.title, path: node.path ?? `${node.folder ?? ""}.md`, children: subpagesOf(node.children) }));

/** A problem with a page name typed by the user, or null. */
export const pageNameProblem = (value: string): string | null =>
  /(^|\/)\.\.?($|\/)/.test(value) || /[\\:*?"<>|]/.test(value) ? "Use letters, digits, spaces, dashes and / for nesting." : null;

/** The page file of a name typed by the user: `Guide/Setup` → `docs/Guide/Setup.md`. */
export const pagePath = (root: string, name: string): string => `${root}/${name.replace(/^\/+|\/+$/g, "").replace(/\.md$/i, "")}.md`;
