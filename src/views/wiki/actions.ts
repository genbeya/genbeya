import { useCallback, useMemo } from "react";
import type { WikiNode } from "../../../shared/api";
import { api } from "../../api";
import { useDialogs } from "../../components/Dialog";
import { useRouter } from "../../app/router";
import { useWorkspace } from "../../app/workspace";
import type { LinkTarget } from "../../markdown/Markdown";

/** Path of a page relative to the wiki root, without `.md`. */
export const pageName = (path: string, root: string) => path.slice(root.length + 1).replace(/\.md$/i, "");

export function findPage(nodes: WikiNode[], path: string): { node: WikiNode; trail: WikiNode[] } | null {
  for (const node of nodes) {
    if (node.path === path || (node.dir && node.dir === path)) return { node, trail: [] };
    const inner = findPage(node.children, path);
    if (inner) return { node: inner.node, trail: [node, ...inner.trail] };
  }
  return null;
}

export const flattenPages = (nodes: WikiNode[]): { title: string; path: string }[] =>
  nodes.flatMap((n) => [...(n.path ? [{ title: n.title, path: n.path }] : []), ...flattenPages(n.children)]);

const validName = (value: string) =>
  /(^|\/)\.\.?($|\/)/.test(value) || /[\\:*?"<>|]/.test(value)
    ? "Use letters, digits, spaces, dashes and / for nesting."
    : null;

/** Creating, moving and deleting pages, shared by the wiki and the command palette. */
export function useWikiActions() {
  const { snapshot, run, contentChanged } = useWorkspace();
  const { navigate } = useRouter();
  const dialogs = useDialogs();
  const root = snapshot.settings.wikiRoot;

  const createPage = useCallback(
    async (parent?: string, name?: string) => {
      const prefix = parent ? pageName(parent, root) + "/" : "";
      const value = await dialogs.prompt({
        title: "New page",
        label: "Page name",
        initial: prefix + (name ?? ""),
        placeholder: "Architecture/Database",
        confirm: "Create",
        hint: "Use / to nest pages. The page is saved as Markdown in " + root + "/.",
        validate: validName,
      });
      if (!value) return;
      const path = `${root}/${value.replace(/^\/+|\/+$/g, "").replace(/\.md$/i, "")}.md`;
      const created = await run(() => api().createPage(path));
      if (created) {
        contentChanged();
        navigate({ view: "wiki", page: created.path });
      }
      return created;
    },
    [root, dialogs, run, navigate, contentChanged],
  );

  const movePage = useCallback(
    async (path: string) => {
      const value = await dialogs.prompt({
        title: "Move page",
        label: "New name",
        initial: pageName(path, root),
        confirm: "Move",
        hint: "Subpages move along. Links to this page are not rewritten.",
        validate: validName,
      });
      if (!value) return;
      const moved = await run(() => api().movePage(path, `${root}/${value.replace(/\.md$/i, "")}.md`), "Page moved");
      if (moved) {
        contentChanged();
        navigate({ view: "wiki", page: moved }, { replace: true });
      }
    },
    [root, dialogs, run, navigate, contentChanged],
  );

  const deletePage = useCallback(
    async (path: string) => {
      const ok = await dialogs.confirm({
        title: "Delete page",
        message: `Delete ${pageName(path, root)}? The file is removed from the working tree; Git history keeps it.`,
        confirm: "Delete",
        danger: true,
      });
      if (!ok) return;
      const done = await run(async () => {
        await api().deletePage(path);
        return true;
      }, "Page deleted");
      if (done) {
        contentChanged();
        navigate({ view: "wiki" }, { replace: true });
      }
    },
    [root, dialogs, run, navigate, contentChanged],
  );

  /** Follows a link from a wiki page or task description. */
  const followLink = useCallback(
    (target: LinkTarget) => {
      if (target.kind === "external") {
        if (/^(https?|mailto):/i.test(target.url)) void api().openExternal(target.url);
        return;
      }
      if (target.kind === "missing") return void createPage(undefined, target.title);
      if (target.kind !== "file") return;
      let path = target.path;
      const { taskRoot } = snapshot.settings;
      if (path.startsWith(taskRoot + "/")) {
        const task = snapshot.tasks.find((t) => t.path === path);
        if (task) return void navigate({ view: "tasks", task: task.id });
      }
      if (path.startsWith(root + "/") || path === root) {
        // Links may omit `.md` or point at a page's folder.
        if (!/\.[a-z0-9]+$/i.test(path)) path += ".md";
        if (path.endsWith(".md")) {
          const found = findPage(snapshot.wiki, path) ?? findPage(snapshot.wiki, path.slice(0, -3));
          if (found?.node.path) return void navigate({ view: "wiki", page: found.node.path, anchor: target.anchor });
          if (found?.node.dir) return void navigate({ view: "wiki", dir: found.node.dir });
          return void navigate({ view: "wiki", page: path, anchor: target.anchor });
        }
      }
      navigate({ view: "code", file: path });
    },
    [snapshot, root, navigate, createPage],
  );

  return { createPage, movePage, deletePage, followLink };
}

/** Pages and tasks that Markdown can link to by title or ID. */
export function useLinkTargets() {
  const { snapshot } = useWorkspace();
  const pages = useMemo(() => flattenPages(snapshot.wiki), [snapshot.wiki]);
  const tasks = useMemo(() => snapshot.tasks.map((t) => ({ id: t.id, path: t.path })), [snapshot.tasks]);
  return { pages, tasks };
}
