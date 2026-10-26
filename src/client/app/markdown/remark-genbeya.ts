import { toString } from "mdast-util-to-string";
import { SKIP, visit } from "unist-util-visit";
import type { Code, Link, List, ListItem, Paragraph, PhrasingContent, Root, RootContent, Table, TableRow, Text } from "mdast";
import {
  dependenciesOf,
  dependencyChart,
  effortOf,
  formatEffort,
  formatVariance,
  matchesFilter,
  parseFilter,
  timeline,
  type PlanTask,
} from "../../../utilities/planning";
import { fileFragment, shortRevision, WIKILINK } from "../../../utilities/references";
import type { DateOptions } from "./dates";
import { headingIds } from "./headings";
import type { MentionOptions } from "./mentions";
import { normalizeTitle, referenceTargets, resolveReference, type Reference, type ReferenceSources } from "./references";

export interface PageRef {
  title: string;
  path: string;
  children: PageRef[];
}

export interface GenbeyaOptions extends MentionOptions, DateOptions {
  /** Pages below the current one, for `[SUBPAGES]`. */
  subpages?: PageRef[];
  /** Tasks, pages and files that `[[references]]` and task IDs in text point to. */
  references?: ReferenceSources;
  /** The tasks that plan macros (`[EFFORT]`, `[DEPENDENCIES]`, `[GANTT]`) show, and the workflow, whose last state is done. */
  plan?: { readonly tasks: readonly PlanTask[]; readonly statuses: readonly string[] };
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
/** `[EFFORT milestone=MVP]` alone in a paragraph: a plan of the matching tasks. */
const PLAN = /^\[(EFFORT|DEPENDENCIES|GANTT)(?:\s+([^\]]*))?\]$/;
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
      const fragment = fileFragment(reference);
      const pinned = reference.revision;
      // Whether a pinned file is there is only known once its revision is read.
      const missing = !pinned && !reference.exists;
      return link(
        "/" + reference.path + (fragment ? "#" + fragment : ""),
        ["md-ref", "md-ref-file", ...(pinned ? ["md-ref-pinned"] : []), ...(missing ? ["md-ref-missing"] : [])],
        [
          span("md-ref-path", label ?? reference.path),
          ...(lines && !label ? [span("md-ref-lines", lines)] : []),
          ...(pinned && !label ? [span("md-ref-rev", shortRevision(pinned))] : []),
        ],
        pinned ? `${reference.path}${lines} as of ${pinned}` : missing ? `${reference.path} is not in the repository` : undefined,
      );
    }
    case "missing-page":
      return link("genbeya-missing:" + encodeURIComponent(reference.title), [], [{ type: "text", value: label ?? reference.title }]);
  }
}

const cell = (value: string): Table["children"][number]["children"][number] => ({
  type: "tableCell",
  children: value ? [{ type: "text", value }] : [],
});
const row = (values: readonly string[]): TableRow => ({ type: "tableRow", children: values.map(cell) });
const hours = (value: number | null) => (value === null ? "—" : formatEffort(value));
const variance = (value: number | null) => (value === null ? "—" : formatVariance(value));
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A plan macro's blocks, from the tasks: `[EFFORT]` a table of estimate,
 * logged, remaining, forecast and variance with totals; `[DEPENDENCIES]` a
 * Mermaid flowchart; `[GANTT]` a Mermaid timeline. What is missing is said,
 * rather than shown as if it were complete.
 */
function plan(kind: string, filterText: string, { tasks, statuses }: NonNullable<GenbeyaOptions["plan"]>): RootContent[] {
  const filter = parseFilter(filterText);
  const shown = tasks.filter((task) => matchesFilter(task, filter));
  if (!shown.length) return [placeholder("No tasks match this plan.")];
  const done = statuses.at(-1);
  const dependencies = dependenciesOf(tasks, statuses);
  const notes: string[] = [];
  const diagram = (value: string): Code => ({ type: "code", lang: "mermaid", meta: null, value });
  if (kind === "DEPENDENCIES") {
    const chart = dependencyChart(shown, tasks, dependencies, statuses);
    const problems = shown.flatMap((task) => (dependencies.problems.get(task.id.toUpperCase()) ?? []).map((text) => `${task.id} ${text}.`));
    return [chart ? diagram(chart) : placeholder("None of these tasks depends on another."), ...problems.map(placeholder)];
  }
  if (kind === "GANTT") {
    const result = timeline(shown, tasks, dependencies, statuses);
    if (!result.chart) return [placeholder("None of these tasks has a due date.")];
    if (result.undated) notes.push(`${count(result.undated, "task")} without a due date ${result.undated === 1 ? "is" : "are"} left out.`);
    if (result.conflicts.length)
      notes.push(`${result.conflicts.join(", ")} ${result.conflicts.length === 1 ? "starts" : "start"} before a task it waits for is due.`);
    return [diagram(result.chart), ...notes.map(placeholder)];
  }
  const efforts = shown.map((task) => ({ task, effort: effortOf(task, task.status === done) }));
  const sum = (values: (number | null)[]) => {
    const known = values.filter((value): value is number => value !== null);
    return known.length ? known.reduce((a, b) => a + b, 0) : null;
  };
  const table: Table = {
    type: "table",
    align: [null, null, "right", "right", "right", "right", "right"],
    children: [
      row(["Task", "Status", "Estimate", "Logged", "Remaining", "Forecast", "Variance"]),
      ...efforts.map(({ task, effort }) =>
        row([
          `[[${task.id}]]`,
          task.status,
          hours(effort.estimate),
          formatEffort(effort.logged),
          hours(effort.remaining),
          hours(effort.forecast),
          variance(effort.variance),
        ]),
      ),
      row([
        `Total, ${count(shown.length, "task")}`,
        "",
        hours(sum(efforts.map(({ effort }) => effort.estimate))),
        formatEffort(sum(efforts.map(({ effort }) => effort.logged)) ?? 0),
        hours(sum(efforts.map(({ effort }) => effort.remaining))),
        hours(sum(efforts.map(({ effort }) => effort.forecast))),
        variance(sum(efforts.map(({ effort }) => effort.variance))),
      ]),
    ],
  };
  const noEstimate = efforts.filter(({ effort }) => effort.estimate === null).length;
  const noRemaining = efforts.filter(({ effort }) => effort.remaining === null).length;
  const unreadable = shown.reduce((total, task) => total + task.unreadable, 0);
  if (noEstimate) notes.push(`${count(noEstimate, "task")} without an estimate.`);
  if (noRemaining) notes.push(`${count(noRemaining, "unfinished task")} without a remaining effort.`);
  if (unreadable) notes.push(`${count(unreadable, "time log line")} that can't be read.`);
  return [table, ...(notes.length ? [placeholder(`Totals leave out ${notes.join(" ").replace(/\.(?= )/g, ";")}`)] : [])];
}

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
 * Genbeya's wiki extensions:
 * - heading ids, and `[TOC]` / `[[_TOC_]]` for a table of contents
 * - `[SUBPAGES]` / `[[_TOSP_]]` for the pages below this one
 * - `[EFFORT]`, `[DEPENDENCIES]` and `[GANTT]`, with filters such as `milestone=MVP`, for plans of the tasks
 * - `[[GENBEYA-12]]`, `[[Page title]]`, `[[path/to/file.ts#L1-L9]]` references, `[[target|label]]`
 * - `[[path/to/file.ts#L1-L9@v1.0]]` pinned to a revision, `#@v1.0` for a whole file
 * - `![[path/to/file.ts#L1-L9]]` alone in a paragraph embeds the lines, of a revision when pinned
 */
export function remarkGenbeya(options: GenbeyaOptions = {}) {
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
      const macro = PLAN.exec(text);
      if (macro) {
        const blocks = options.plan ? plan(macro[1]!, macro[2] ?? "", options.plan) : [placeholder("No tasks to plan here.")];
        parent.children.splice(index, 1, ...(blocks as typeof parent.children));
        return [SKIP, index + blocks.length];
      }
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
                dataRevision: reference.revision ?? undefined,
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
  };
}
