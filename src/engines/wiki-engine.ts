/**
 * Wiki structure: pages are Markdown files below the wiki folder, and
 * `Architecture.md` is the parent page of the folder `Architecture/`. File
 * names use dashes for spaces: `Getting-started.md` is "Getting started".
 */
import type { FileNode, Settings, WikiNode } from "../contracts/model";
import { buildFileTree, findNode } from "../utilities/file-tree";
import { baseName, within } from "../utilities/repository-path";

type WikiSettings = Pick<Settings, "wikiRoot" | "wikiHome">;
const isMarkdown = (name: string) => name.toLowerCase().endsWith(".md");
const titleOfName = (name: string) => name.replace(/-/g, " ");
const byTitle = (a: WikiNode, b: WikiNode) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: "base" });

function nodes(level: readonly FileNode[]): WikiNode[] {
  const folders = level.filter((node) => node.children);
  const pages = level.filter((node) => !node.children && isMarkdown(node.name));
  const pageName = (page: FileNode) => page.name.slice(0, -3);
  const result: WikiNode[] = folders
    .map((folder) => ({
      title: titleOfName(folder.name),
      path: pages.find((page) => pageName(page) === folder.name)?.path ?? null,
      folder: folder.path,
      children: nodes(folder.children!),
    }))
    .filter((node) => node.path || node.children.length);
  for (const page of pages)
    if (!folders.some((folder) => folder.name === pageName(page)))
      result.push({ title: titleOfName(pageName(page)), path: page.path, folder: null, children: [] });
  return result.sort(byTitle);
}

export class WikiEngine {
  /** The page tree of the wiki folder; the home page comes first. */
  tree(files: readonly string[], settings: WikiSettings): WikiNode[] {
    const root = findNode(buildFileTree(files.filter((file) => within(file, settings.wikiRoot))), settings.wikiRoot);
    const home = `${settings.wikiRoot}/${settings.wikiHome}`;
    return nodes(root?.children ?? []).sort((a, b) => Number(b.path === home) - Number(a.path === home));
  }

  isPage(path: string, settings: Pick<Settings, "wikiRoot">): boolean {
    return within(path, settings.wikiRoot) && isMarkdown(path);
  }

  titleOf(path: string): string {
    return titleOfName(baseName(path).replace(/\.md$/i, ""));
  }

  /** The content of a new page: its title as the heading. */
  newPage(path: string): string {
    return `# ${this.titleOf(path)}\n\n`;
  }

  subpageFolder(page: string): string {
    return page.replace(/\.md$/i, "");
  }

  /** The renames that move a page, and its subpages when it has them. */
  planMove(from: string, to: string, hasSubpages: boolean): [string, string][] {
    if (from === to) return [];
    const folder = this.subpageFolder(from);
    if (hasSubpages && within(to, folder)) throw new Error("A page cannot move below itself.");
    return hasSubpages
      ? [
          [from, to],
          [folder, this.subpageFolder(to)],
        ]
      : [[from, to]];
  }
}
