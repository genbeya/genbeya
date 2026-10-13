/** Where `[[references]]` are in Markdown text, outside code, for VS Code's editor (links, hovers, warnings). */
import { WIKILINK } from "../../utilities/references";

export interface FoundLink {
  /** Offsets of the whole `[[…]]`. */
  readonly start: number;
  readonly end: number;
  /** What is between the brackets, before any `|label`. */
  readonly target: string;
}

/** Fenced code blocks and inline code spans, as [start, end) offsets: references there are text. */
export function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = [];
  const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*$/gm;
  let open: { start: number; marker: string } | null = null;
  for (let match = fence.exec(text); match; match = fence.exec(text)) {
    const marker = match[2]!;
    if (!open) open = { start: match.index, marker };
    else if (
      marker[0] === open.marker[0] &&
      marker.length >= open.marker.length &&
      !/\S/.test(match[0].slice(match[1]!.length + marker.length))
    ) {
      ranges.push([open.start, match.index + match[0].length]);
      open = null;
    }
  }
  if (open) ranges.push([open.start, text.length]);
  const inside = (offset: number) => ranges.some(([start, end]) => offset >= start && offset < end);
  const span = /(`+)[^`]*?\1/g;
  for (let match = span.exec(text); match; match = span.exec(text)) {
    if (!inside(match.index)) ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/** The references in `text` that are not inside code. */
export function referencesIn(text: string): FoundLink[] {
  const code = codeRanges(text);
  const links: FoundLink[] = [];
  for (const match of text.matchAll(new RegExp(WIKILINK.source, "g"))) {
    const start = match.index;
    if (code.some(([from, to]) => start >= from && start < to)) continue;
    links.push({ start, end: start + match[0].length, target: match[1]!.trim() });
  }
  return links;
}

/** The text after an unclosed `[[` at the end of `before` (the line up to the cursor), or null. */
export const openReference = (before: string): string | null => /\[\[([^\]|\n]*)$/.exec(before)?.[1] ?? null;
