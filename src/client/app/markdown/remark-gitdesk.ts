import { toString } from "mdast-util-to-string";
import { SKIP, visit } from "unist-util-visit";
import type { Blockquote, Link, List, ListItem, Paragraph, PhrasingContent, Root, Text } from "mdast";
import { WIKILINK } from "../../../utilities/references";
import { headingIds } from "./headings";
import { normalizeTitle, referenceTargets, resolveReference, type Reference, type ReferenceSources } from "./references";

export interface PageRef {
  title: string;
  path: string;
  children: PageRef[];
}

export interface GitdeskOptions {
  /** Pages below the current one, for `[SUBPAGES]`. */
  subpages?: PageRef[];
  /** Tasks, pages and files that `[[references]]` and task IDs in text point to. */
  references?: ReferenceSources;
}

const NO_REFERENCES: ReferenceSources = { wikiRoot: "docs", pages: [], tasks: [], statuses: [], files: [] };

interface Entry {
  label: string;
  url: string;
  children: Entry[];
}

// `[[_TOC_]]` parses as `[[` + emphasis + `]]`, so match the paragraph's plain text.
const TOC = /^\[(?:TOC|\[_?TOC_?\])\]$/i;
const SUBPAGES = /^\[(?:SUBPAGES|\[_?TOSP_?\])\]$/i;
/** `![[path#L1-L9]]` alone in a paragraph embeds those lines of a file. */
const EMBED = /^!\[\[([^\]|\n]+)\]\]$/;
const TASK_ID = /\b[A-Z][A-Z0-9]*-\d+\b/g;

export { normalizeTitle };

const span = (className: string, value: string): PhrasingContent => ({
  type: "emphasis",
  data: { hName: "span", hProperties: { className: className.split(" ") } },
  children: value ? [{ type: "text", value }] : [],
});

const stateName = (status: string) => status.replace(/[-_]+/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

/** A reference as a link: tasks show ID, title and state; pages their title; files their path and lines. */
function referenceLink(reference: Reference, label: string | undefined): PhrasingContent {
  const link = (url: string, className: string[], children: PhrasingContent[], title?: string): Link => ({
    type: "link",
    url,
    title: title ?? null,
    data: { hProperties: { className } },
    children,
  });
  switch (reference.kind) {
    case "task":
      return link(
        "/" + reference.path,
        ["md-ref", "md-ref-task"],
        [
          span(`md-ref-dot tone-${reference.tone}`, ""),
          span("md-ref-id", reference.id),
          span("md-ref-title", label ?? reference.title),
          span(`md-ref-state tone-${reference.tone}`, stateName(reference.status)),
        ],
        `${reference.id}: ${reference.title} (${stateName(reference.status)})`,
      );
    case "page":
      return link(
        "/" + reference.path + (reference.anchor ? "#" + reference.anchor : ""),
        ["md-ref", "md-ref-page"],
        [{ type: "text", value: label ?? reference.title }],
      );
    case "file": {
      const { from, to } = reference.lines ?? { from: 0, to: 0 };
      const lines = !reference.lines ? "" : from === to ? `:${from}` : `:${from}–${to}`;
      return link(
        "/" + reference.path + (reference.lines ? `#L${from}-L${to}` : ""),
        ["md-ref", "md-ref-file", ...(reference.exists ? [] : ["md-ref-missing"])],
        [span("md-ref-path", label ?? reference.path), ...(lines && !label ? [span("md-ref-lines", lines)] : [])],
        reference.exists ? undefined : `${reference.path} is not in the repository`,
      );
    }
    case "missing-page":
      return link("gitdesk-missing:" + encodeURIComponent(reference.title), [], [{ type: "text", value: label ?? reference.title }]);
  }
}
const CALLOUT = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i;

function list(entries: Entry[], className?: string): List {
  return {
    type: "list",
    ordered: false,
    spread: false,
    data: className ? { hProperties: { className: [className] } } : undefined,
    children: entries.map((entry): ListItem => ({
      type: "listItem",
      spread: false,
      children: [
        {
          type: "paragraph",
          children: [{ type: "link", url: entry.url, children: [{ type: "text", value: entry.label }] }],
        },
        ...(entry.children.length ? [list(entry.children)] : []),
      ],
    })),
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
    while (stack.length > 1 && stack.at(-1)!.depth >= heading.depth) stack.pop();
    const entry: Entry = { label: heading.label, url: "#" + heading.slug, children: [] };
    stack.at(-1)!.children.push(entry);
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
 * - `[[GENBEYA-12]]`, `[[Page title]]`, `[[path/to/file.ts#L1-L9]]` references, `[[target|label]]`
 * - `![[path/to/file.ts#L1-L9]]` alone in a paragraph embeds the lines
 * - GitHub-style callouts: `> [!NOTE]`, `[!TIP]`, `[!WARNING]`, ...
 */
export function remarkGitdesk(options: GitdeskOptions = {}) {
  return (tree: Root) => {
    const targets = referenceTargets(options.references ?? NO_REFERENCES);
    const headings = headingIds(tree).map(({ heading: node, id: slug }) => {
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, id: slug } };
      return { depth: node.depth, label: toString(node), slug };
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
      } else if (EMBED.test(text)) {
        const reference = resolveReference(EMBED.exec(text)![1]!, targets);
        // Only files embed; other references show as links.
        if (reference.kind === "file")
          replacement = {
            type: "paragraph",
            data: {
              hName: "div",
              hProperties: {
                className: ["md-embed"],
                dataEmbed: reference.path,
                dataLines: reference.lines ? `${reference.lines.from}-${reference.lines.to}` : undefined,
              },
            },
            children: [],
          };
        else node.children = [{ type: "text", value: text.slice(1) }];
      }
      if (!replacement) return;
      parent.children.splice(index, 1, replacement);
      return [SKIP, index + 1];
    });

    const byId = targets.tasks;
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
        ...(byId.size
          ? [...node.value.matchAll(TASK_ID)].filter((m) => byId.has(m[0].toUpperCase())).map((m) => ({ m, kind: "task" as const }))
          : []),
      ].sort((a, b) => a.m.index! - b.m.index!);
      for (const { m, kind } of matches) {
        if (m.index! < last) continue;
        if (kind === "task") {
          // Task IDs in prose stay short; the tooltip has the rest.
          const task = byId.get(m[0].toUpperCase())!;
          push(m.index!, m.index! + m[0].length, {
            type: "link",
            url: "/" + task.path,
            title: `${task.title} (${stateName(task.status)})`,
            data: { hProperties: { className: ["md-task-ref"] } },
            children: [{ type: "text", value: m[0] }],
          });
          continue;
        }
        push(m.index!, m.index! + m[0].length, referenceLink(resolveReference(m[1]!, targets), m[2]?.trim()));
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
      const kind = match[1]!.toLowerCase();
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
