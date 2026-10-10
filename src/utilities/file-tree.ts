import type { FileNode } from "../contracts/model";

interface MutableNode {
  name: string;
  path: string;
  children?: MutableNode[];
}

const compare = (a: FileNode, b: FileNode) =>
  Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** A sorted folder tree (folders first, natural order) from repository-relative file paths. */
export function buildFileTree(paths: readonly string[]): FileNode[] {
  const root: MutableNode = { name: "", path: "", children: [] };
  const folders = new Map<string, MutableNode>([["", root]]);
  const folder = (path: string): MutableNode => {
    const known = folders.get(path);
    if (known) return known;
    const cut = path.lastIndexOf("/");
    const node: MutableNode = { name: path.slice(cut + 1), path, children: [] };
    folder(cut < 0 ? "" : path.slice(0, cut)).children!.push(node);
    folders.set(path, node);
    return node;
  };
  for (const path of paths) {
    const cut = path.lastIndexOf("/");
    folder(cut < 0 ? "" : path.slice(0, cut)).children!.push({ name: path.slice(cut + 1), path });
  }
  const sort = (nodes: MutableNode[]): MutableNode[] => {
    nodes.sort(compare);
    for (const node of nodes) if (node.children) sort(node.children);
    return nodes;
  };
  return sort(root.children!);
}

/** The paths of every file in `nodes`, depth first. */
export const filePaths = (nodes: readonly FileNode[]): string[] =>
  nodes.flatMap((node) => (node.children ? filePaths(node.children) : [node.path]));

export function findNode(nodes: readonly FileNode[], path: string): FileNode | undefined {
  let level = nodes;
  let found: FileNode | undefined;
  for (const part of path.split("/")) {
    found = level.find((node) => node.name === part);
    level = found?.children ?? [];
  }
  return found;
}
