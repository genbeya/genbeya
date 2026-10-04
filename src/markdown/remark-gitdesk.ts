import GithubSlugger from "github-slugger";
import { toString } from "mdast-util-to-string";
import { SKIP, visit } from "unist-util-visit";
import type { Blockquote, Heading, List, ListItem, Paragraph, PhrasingContent, Root, Text } from "mdast";

export interface PageRef {
  title: string;
  path: string;
  children: PageRef[];
}

export interface GitdeskOptions {
  /** Pages below the current one, for `[SUBPAGES]`. */
  subpages?: PageRef[];
  /** Every wiki page, for `[[Page title]]` links. */
  pages?: { title: string; path: string }[];
  /** Task IDs and their files; IDs in text become links. */
  tasks?: { id: string; path: string }[];
}

interface Entry {
  label: string;
  url: string;
  children: Entry[];
}

// `[[_TOC_]]` parses as `[[` + emphasis + `]]`, so match the paragraph's plain text.
const TOC = /^\[(?:TOC|\[_?TOC_?\])\]$/i;
const SUBPAGES = /^\[(?:SUBPAGES|\[_?TOSP_?\])\]$/i;
const WIKILINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const TASK_ID = /\b[A-Z][A-Z0-9]*-\d+\b/g;

/** Titles match regardless of case, dashes and underscores. */
export const normalizeTitle = (title: string) => title.toLowerCase().replace(/[-_\s]+/g, " ").trim();
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i;

function list(entries: Entry[], className?: string): List {
  return {
    type: "list",
    ordered: false,
    spread: false,
    data: className ? { hProperties: { className: [className] } } : undefined,
    children: entries.map(
      (entry): ListItem => ({
        type: "listItem",
        spread: false,
        children: [
          {
            type: "paragraph",
            children: [{ type: "link", url: entry.url, children: [{ type: "text", value: entry.label }] }],
          },
          ...(entry.children.length ? [list(entry.children)] : []),
        ],
      }),
    ),
  };
}

function placeholder(text: string): Paragraph {
  return {
    type: "paragraph",
    data: { hProperties: { className: ["md-placeholder"] } },
    children: [{ type: "text", value: text }],
  };
}

/** Nests h2–h4 headings by depth. */
function outline(headings: { depth: number; label: string; slug: string }[]): Entry[] {
  const root: Entry[] = [];
  const stack: { depth: number; children: Entry[] }[] = [{ depth: 1, children: root }];
  for (const heading of headings) {
    if (heading.depth < 2 || heading.depth > 4) continue;
    while (stack.length > 1 && stack[stack.length - 1].depth >= heading.depth) stack.pop();
    const entry: Entry = { label: heading.label, url: "#" + heading.slug, children: [] };
    stack[stack.length - 1].children.push(entry);
    stack.push({ depth: heading.depth, children: entry.children });
  }
  return root;
}

const pageEntries = (pages: PageRef[]): Entry[] =>
  pages.map((p) => ({ label: p.title, url: "/" + p.path, children: pageEntries(p.children) }));

/**
 * GitDesk's wiki extensions:
 * - heading ids, and `[TOC]` / `[[_TOC_]]` for a table of contents
 * - `[SUBPAGES]` / `[[_TOSP_]]` for the pages below this one
 * - `[[Page title]]` and `[[Page title|label]]` links
 * - GitHub-style callouts: `> [!NOTE]`, `[!TIP]`, `[!WARNING]`, ...
 */
export function remarkGitdesk(options: GitdeskOptions = {}) {
  return (tree: Root) => {
    const slugger = new GithubSlugger();
    const headings: { depth: number; label: string; slug: string }[] = [];
    visit(tree, "heading", (node: Heading) => {
      const label = toString(node);
      const slug = slugger.slug(label);
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: slug } };
      headings.push({ depth: node.depth, label, slug });
    });

    visit(tree, "paragraph", (node: Paragraph, index, parent) => {
      if (!parent || index === undefined || node.children.some((c) => c.type !== "text" && c.type !== "emphasis")) return;
      const text = toString(node).trim();
      let replacement: List | Paragraph | null = null;
      if (TOC.test(text)) {
        const entries = outline(headings);
        replacement = entries.length ? list(entries, "md-toc") : placeholder("This page has no sections yet.");
      } else if (SUBPAGES.test(text)) {
        const entries = pageEntries(options.subpages ?? []);
        replacement = entries.length ? list(entries, "md-subpages") : placeholder("This page has no subpages yet.");
      }
      if (!replacement) return;
      parent.children.splice(index, 1, replacement);
      return [SKIP, index + 1];
    });

    const byTitle = new Map((options.pages ?? []).map((p) => [normalizeTitle(p.title), p.path]));
    const byId = new Map((options.tasks ?? []).map((t) => [t.id, t.path]));
    visit(tree, "text", (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === "link") return;
      const parts: PhrasingContent[] = [];
      let last = 0;
      const push = (at: number, end: number, link: PhrasingContent) => {
        if (at > last) parts.push({ type: "text", value: node.value.slice(last, at) });
        parts.push(link);
        last = end;
      };
      const matches = [
        ...[...node.value.matchAll(WIKILINK)].map((m) => ({ m, kind: "page" as const })),
        ...(byId.size ? [...node.value.matchAll(TASK_ID)].filter((m) => byId.has(m[0])).map((m) => ({ m, kind: "task" as const })) : []),
      ].sort((a, b) => a.m.index! - b.m.index!);
      for (const { m, kind } of matches) {
        if (m.index! < last) continue;
        if (kind === "task") {
          push(m.index!, m.index! + m[0].length, {
            type: "link",
            url: "/" + byId.get(m[0]),
            data: { hProperties: { className: ["md-task-ref"] } },
            children: [{ type: "text", value: m[0] }],
          });
          continue;
        }
        const title = m[1].trim();
        const path = byTitle.get(normalizeTitle(title));
        push(m.index!, m.index! + m[0].length, {
          type: "link",
          url: path ? "/" + path : "gitdesk-missing:" + encodeURIComponent(title),
          children: [{ type: "text", value: (m[2] ?? m[1]).trim() }],
        });
      }
      if (!parts.length) return;
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      (parent.children as PhrasingContent[]).splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });

    visit(tree, "blockquote", (node: Blockquote) => {
      const first = node.children[0];
      if (first?.type !== "paragraph" || first.children[0]?.type !== "text") return;
      const text = first.children[0] as Text;
      const match = CALLOUT.exec(text.value);
      if (!match) return;
      const kind = match[1].toLowerCase();
      text.value = text.value.slice(match[0].length);
      if (!text.value && first.children.length === 1) node.children.shift();
      else if (!text.value && first.children[1]?.type === "break") first.children.splice(0, 2);
      node.data = {
        ...node.data,
        hProperties: { className: ["callout", `callout-${kind}`], "data-callout": kind },
      };
    });
  };
}
