/**
 * Code blocks for engineering docs, with the meta strings Docusaurus and
 * rehype-pretty-code use (GitHub ignores them):
 * - ```ts title="src/app.ts" — a file name above the code
 * - ```ts showLineNumbers (or showLineNumbers=10 to start at 10) — line numbers
 * - ```ts {2,4-6} — highlighted lines; ins={3} and del={4} mark added and removed ones
 * - ```diff — added and removed lines coloured; ```diff-ts also highlights them as TypeScript
 */
import type { Element, ElementContent, Root as HastRoot } from "hast";
import type { Code, Root } from "mdast";
import { visit } from "unist-util-visit";

export interface CodeMeta {
  readonly title: string | null;
  /** The first line's number when lines are numbered, else null. */
  readonly firstLine: number | null;
  readonly marked: LineRanges;
  readonly added: LineRanges;
  readonly removed: LineRanges;
}

/** Inclusive ranges of line numbers, counted from 1. */
export type LineRanges = readonly (readonly [number, number])[];

const TITLE = /(?:^|\s)(?:title|filename)=(?:"([^"]*)"|'([^']*)'|(\S+))/;
const LINE_NUMBERS = /(?:^|\s)showLineNumbers(?:=(\d+))?(?=\s|$)/;
const RANGES = (prefix: string) => new RegExp(`(?:^|\\s)${prefix}\\{([\\d\\s,-]*)\\}`);
const MARKED = RANGES("");
const ADDED = RANGES("ins=");
const REMOVED = RANGES("del=");
/** ```ts{1,3} without a space: the braces stick to the language. */
const LANGUAGE_WITH_RANGES = /^([^{]+)(\{[\d\s,-]*\})$/;
const DIFF_LANGUAGE = /^diff-(.+)$/i;

/** `1,3-5` as ranges; malformed parts are left out. */
export function lineRanges(text: string): LineRanges {
  const ranges: [number, number][] = [];
  for (const part of text.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!match) continue;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    if (from >= 1 && to >= from) ranges.push([from, to]);
  }
  return ranges;
}

export const inRanges = (ranges: LineRanges, line: number): boolean => ranges.some(([from, to]) => line >= from && line <= to);

export function parseCodeMeta(meta: string | null | undefined): CodeMeta {
  const text = meta ?? "";
  const title = TITLE.exec(text);
  const numbers = LINE_NUMBERS.exec(text);
  return {
    title: title ? (title[1] ?? title[2] ?? title[3] ?? "").trim() || null : null,
    firstLine: numbers ? Number(numbers[1] ?? 1) : null,
    marked: lineRanges(MARKED.exec(text)?.[1] ?? ""),
    added: lineRanges(ADDED.exec(text)?.[1] ?? ""),
    removed: lineRanges(REMOVED.exec(text)?.[1] ?? ""),
  };
}

/** Code as lines, each with the elements (highlighting spans) it is inside of. */
export function splitLines(nodes: readonly ElementContent[]): ElementContent[][] {
  const lines: ElementContent[][] = [[]];
  for (const node of nodes) {
    if (node.type === "text") {
      node.value.split("\n").forEach((part, index) => {
        if (index) lines.push([]);
        if (part) lines.at(-1)!.push({ type: "text", value: part });
      });
    } else if (node.type === "element") {
      splitLines(node.children).forEach((part, index) => {
        if (index) lines.push([]);
        if (part.length) lines.at(-1)!.push({ ...node, children: part });
      });
    }
  }
  return lines;
}

/**
 * Before highlighting: braces stuck to the language move to the meta, and
 * ```diff-ts loses its `+`/`-` column so the code highlights as TypeScript;
 * the column is kept on the element and put back line by line afterwards.
 */
export function remarkCodeBlocks() {
  return (tree: Root) => {
    visit(tree, "code", (node: Code) => {
      const stuck = node.lang ? LANGUAGE_WITH_RANGES.exec(node.lang) : null;
      if (stuck) {
        node.lang = stuck[1]!;
        node.meta = [stuck[2], node.meta].filter(Boolean).join(" ");
      }
      const diff = node.lang ? DIFF_LANGUAGE.exec(node.lang) : null;
      if (!diff) return;
      const lines = node.value.split("\n");
      node.lang = diff[1]!;
      node.value = lines.map((line) => line.slice(1)).join("\n");
      node.data = { ...node.data, hProperties: { ...node.data?.hProperties, dataDiff: lines.map((line) => line[0] ?? " ").join("") } };
    });
  };
}

const languageOf = (code: Element): string =>
  ((code.properties["className"] as string[] | undefined) ?? []).find((name) => String(name).startsWith("language-"))?.slice(9) ?? "";

const span = (className: string[], children: ElementContent[], properties: Element["properties"] = {}): Element => ({
  type: "element",
  tagName: "span",
  properties: { className, ...properties },
  children,
});

/** The `+`, `-` or ` ` that starts each line of a diff, or null when the block is no diff. */
function diffSigns(code: Element, lines: readonly ElementContent[][]): string | null {
  const kept = code.properties["dataDiff"];
  if (typeof kept === "string") return kept;
  if (languageOf(code) !== "diff") return null;
  return lines
    .map((line) => {
      const text = line.map((node) => (node.type === "text" ? node.value : textOf(node))).join("");
      // Headers (`+++ b/file`) are no changes.
      return /^(\+\+\+|---)/.test(text) ? " " : (text[0] ?? " ");
    })
    .join("");
}

const textOf = (node: ElementContent): string =>
  node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";

/**
 * After highlighting: code that needs lines (numbers, marks, diffs) gets one
 * `.md-line` span per line. The title and numbering go on the `code`
 * element for the DOM builder.
 */
export function rehypeCodeBlocks() {
  return (tree: HastRoot) => {
    visit(tree, "element", (pre: Element) => {
      if (pre.tagName !== "pre") return;
      const code = pre.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
      if (!code) return;
      const meta = parseCodeMeta((code.data as { meta?: string } | undefined)?.meta);
      if (meta.title) code.properties["dataTitle"] = meta.title;
      const lines = splitLines(code.children);
      if (lines.length > 1 && !lines.at(-1)!.length) lines.pop();
      const signs = diffSigns(code, lines);
      const kept = typeof code.properties["dataDiff"] === "string";
      delete code.properties["dataDiff"];
      if (meta.firstLine === null && !meta.marked.length && !meta.added.length && !meta.removed.length && signs === null) return;
      if (meta.firstLine !== null) code.properties["dataNumbered"] = true;
      code.children = lines.map((line, index): Element => {
        const number = index + 1;
        const sign = signs?.[index] ?? " ";
        const className = ["md-line"];
        if (inRanges(meta.marked, number)) className.push("is-marked");
        if (sign === "+" || inRanges(meta.added, number)) className.push("is-added");
        if (sign === "-" || inRanges(meta.removed, number)) className.push("is-removed");
        const content: ElementContent[] = kept ? [span(["md-diff-sign"], [{ type: "text", value: sign }]), ...line] : line;
        if (index < lines.length - 1) content.push({ type: "text", value: "\n" });
        return span(className, content, meta.firstLine === null ? {} : { dataLine: meta.firstLine + index });
      });
    });
  };
}
