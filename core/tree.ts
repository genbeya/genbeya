import type { FileNode, WikiNode } from "../shared/api.js";
import { within } from "./paths.js";

const compare = (a: FileNode, b: FileNode) =>
  Number(!!b.children) - Number(!!a.children) ||
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** Builds a sorted directory tree (directories first) from a flat path list. */
export function buildTree(paths: string[]): FileNode[] {
  const root: FileNode = { name: "", path: "", children: [] };
  const directories = new Map<string, FileNode>([["", root]]);
  const directory = (path: string): FileNode => {
    let node = directories.get(path);
    if (node) return node;
    const cut = path.lastIndexOf("/");
    node = { name: path.slice(cut + 1), path, children: [] };
    directory(cut < 0 ? "" : path.slice(0, cut)).children!.push(node);
    directories.set(path, node);
    return node;
  };
  for (const path of paths) {
    const cut = path.lastIndexOf("/");
    directory(cut < 0 ? "" : path.slice(0, cut)).children!.push({
      name: path.slice(cut + 1),
      path,
    });
  }
  const sort = (nodes: FileNode[]) => {
    nodes.sort(compare);
    for (const node of nodes) if (node.children) sort(node.children);
    return nodes;
  };
  return sort(root.children!);
}

export function findNode(nodes: FileNode[], path: string): FileNode | undefined {
  let level = nodes;
  let found: FileNode | undefined;
  for (const part of path.split("/")) {
    found = level.find((n) => n.name === part);
    level = found?.children ?? [];
  }
  return found;
}

/** File names use dashes for spaces: `Getting-started.md` is "Getting started". */
export const pageTitle = (name: string) => name.replace(/-/g, " ");

/**
 * `Architecture.md` is the page for the sibling folder `Architecture/`.
 * Folders without a page still appear, listing their children.
 */
export function buildWiki(nodes: FileNode[], home: string | null): WikiNode[] {
  const folders = nodes.filter((n) => n.children);
  const pages = nodes.filter((n) => !n.children && n.name.toLowerCase().endsWith(".md"));
  const result: WikiNode[] = folders
    .map((folder) => {
      const page = pages.find((p) => p.name.slice(0, -3) === folder.name);
      const children = buildWiki(folder.children!, null);
      return { title: pageTitle(folder.name), path: page?.path ?? null, dir: folder.path, children };
    })
    .filter((n) => n.path || n.children.length);
  for (const page of pages)
    if (!folders.some((f) => f.name === page.name.slice(0, -3)))
      result.push({ title: pageTitle(page.name.slice(0, -3)), path: page.path, dir: null, children: [] });
  return result.sort(
    (a, b) =>
      Number(b.path === home) - Number(a.path === home) ||
      a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" }),
  );
}

export function wikiTree(files: FileNode[], root: string, home: string) {
  const folder = root ? findNode(files, root) : { children: files };
  return buildWiki(folder?.children ?? [], `${root}/${home}`);
}

export function filesUnder(paths: string[], root: string, extension: string) {
  return paths.filter((p) => within(p, root) && p.toLowerCase().endsWith(extension));
}
