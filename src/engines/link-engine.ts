/**
 * Links between Markdown files when wiki pages move. Relative links and
 * `[[references]]` that point into the moved pages are pointed at their new
 * paths, and relative links inside the moved pages at the same targets as
 * before. Only link destinations and reference targets change, written the
 * way they were (relative or absolute, title or path, with or without `.md`,
 * encoded or not); code, and every other byte, stays as it is. Links and
 * references are read as the renderer reads them: with escapes (`\|` in a
 * table) and character references (`&amp;`) decoded.
 */
import type { Nodes } from "mdast";
import { decodeString } from "micromark-util-decode-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import type { LinkChange, LinkUpdate } from "../contracts/model";
import { findReference, normalizeTitle, WIKILINK, type PathStyle, type ReferenceIndex } from "../utilities/references";
import { baseName, relativeLinkPath, relocate, resolveLinkPath } from "../utilities/repository-path";

export interface MarkdownDocument {
  readonly path: string;
  readonly content: string;
}

/** A document whose links change; `path` is where it is before the move. */
export interface LinkRewrite extends LinkUpdate {
  readonly content: string;
}

export interface MoveContext {
  /** Entries that move (a page and its subpage folder), with everything below them. */
  readonly moves: readonly (readonly [string, string])[];
  /** What references can name before the move. */
  readonly before: ReferenceIndex<{ readonly id: string }>;
  /** What references can name after it. */
  readonly after: ReferenceIndex<{ readonly id: string }>;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface Destination {
  readonly start: number;
  readonly end: number;
  /** Written as `<path>`, which may hold spaces. */
  readonly angle: boolean;
}

const BOM = "﻿";
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const REPOSITORY_PATH: PathStyle = { root: "repository", extension: true };
const WIKI_NAME: PathStyle = { root: "wiki", extension: false };
const parser = unified().use(remarkParse).use(remarkGfm);

export class LinkEngine {
  /** The documents whose links change with their new content, in the order given. */
  rewrite(documents: readonly MarkdownDocument[], context: MoveContext): LinkRewrite[] {
    return documents.flatMap((document) => {
      const bom = document.content.startsWith(BOM) ? BOM : "";
      const source = document.content.slice(bom.length);
      const edits = this.edits(document.path, source, context);
      return edits.length ? [{ path: document.path, ...apply(source, edits, bom) }] : [];
    });
  }

  private edits(path: string, source: string, context: MoveContext): Edit[] {
    const edits: Edit[] = [];
    // The path of a destination changes; its `#anchor` stays. `url` is the destination as the parser read it.
    const destination = (span: Destination | null, url: string) => {
      if (!span) return;
      const written = source.slice(span.start, span.end).split("#", 1)[0]!;
      const text = written && this.destination(written, url.split("#", 1)[0]!, span.angle, path, context);
      if (text) edits.push({ start: span.start, end: span.start + written.length, text });
    };
    visit(parser.parse(source), (node: Nodes, _index, parent) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      if (node.type === "link" || node.type === "image") destination(inlineDestination(source, start, end), node.url);
      else if (node.type === "definition") destination(definitionDestination(source, start, end), node.url);
      // References in a link's text are plain text, like the renderer shows them; they are
      // found in the text it reads, with escapes and character references decoded.
      else if (node.type === "text" && parent?.type !== "link") {
        const { text: value, offsets } = decodeText(source, start, end);
        for (const match of value.matchAll(WIKILINK)) {
          const target = match[1]!;
          const name = target.trim().split("#", 1)[0]!;
          const text = this.reference(target, name, context);
          const at = match.index + 2 + (target.length - target.trimStart().length);
          if (text !== null) edits.push({ start: offsets[at]!, end: offsets[at + name.length]!, text });
        }
      }
    });
    return edits.sort((a, b) => a.start - b.start);
  }

  /**
   * The new path of a Markdown link in `home`, or null when it still points
   * to the same place. `url` is its path as the renderer follows it.
   */
  private destination(written: string, url: string, angle: boolean, home: string, { moves, before }: MoveContext): string | null {
    if (EXTERNAL.test(written)) return null;
    const decoded = decode(url);
    const target = resolveLinkPath(home, decoded);
    const newTarget = movedTarget(target, moves, before.files) ?? target;
    const newHome = relocate(home, moves) ?? home;
    if (resolveLinkPath(newHome, decoded) === newTarget) return null;
    let path = decoded.startsWith("/") ? `/${newTarget}` : relativeLinkPath(newHome, newTarget);
    if (decoded.startsWith("./") && !path.startsWith("../")) path = `./${path}`;
    return angle ? path.replace(/[<>\\]/g, "\\$&") : escape(/%[0-9a-f]{2}/i.test(written) ? encodeURI(path) : path);
  }

  /**
   * The new name in `[[target]]`, or null when the reference still works.
   * Every reference to a page is checked, moved or not: a moved page may
   * take a title another page had to itself.
   */
  private reference(target: string, name: string, { moves, before, after }: MoveContext): string | null {
    const found = findReference(target, before);
    const prefix = /^\/*/.exec(name)![0];
    if (found.kind === "file") {
      const path = movedPath(found.path, moves, before.files);
      return path && prefix + path;
    }
    if (found.kind !== "page") return null;
    const moved = relocate(found.page.path, moves);
    const page = after.pagesByPath.get((moved ?? found.page.path).toLowerCase());
    const reached = findReference(target, after);
    const still = reached.kind === "page" && reached.page.path === page?.path;
    // A moved page named by path is renamed even where the old spelling still reaches it, as by case.
    if (!page || (still && (!moved || (found.style === "title" && normalizeTitle(page.title) === normalizeTitle(name))))) return null;
    const named = (style: PathStyle) => {
      const relative = style.root === "wiki" ? page.path.slice(after.wikiRoot.length + 1) : page.path;
      return prefix + (style.extension ? relative : relative.replace(/\.md$/i, ""));
    };
    const candidates =
      found.style === "title" ? [page.title, named(WIKI_NAME), named(REPOSITORY_PATH)] : [named(found.style), named(REPOSITORY_PATH)];
    // A title that another page also has might name that page instead.
    const reaches = (candidate: string) => {
      const reached = findReference(candidate, after);
      return reached.kind === "page" && reached.page.path === page.path && (reached.style !== "title" || uniqueTitle(page.title, after));
    };
    const chosen = candidates.find(reaches) ?? named(REPOSITORY_PATH);
    return chosen === name ? null : chosen;
  }
}

/**
 * Where `path` is after the move. A path that names no file but differs
 * from a moved one only in case follows it, as Windows and macOS file
 * systems find the file by it; the part below the moved entry stays as
 * written.
 */
function movedPath(path: string, moves: MoveContext["moves"], files: ReadonlySet<string>): string | null {
  const exact = relocate(path, moves);
  if (exact !== null || files.has(path)) return exact;
  const lower = path.toLowerCase();
  for (const [from, to] of moves)
    if (lower === from.toLowerCase() || lower.startsWith(`${from.toLowerCase()}/`)) return to + path.slice(from.length);
  return null;
}

/** Where a link target is after the move; a link may leave out the `.md` of a page. */
function movedTarget(path: string, moves: MoveContext["moves"], files: ReadonlySet<string>): string | null {
  return (
    movedPath(path, moves, files) ?? (baseName(path).includes(".") ? null : (movedPath(`${path}.md`, moves, files)?.slice(0, -3) ?? null))
  );
}

/** A character escape or reference, as Markdown decodes them in text. */
const ESCAPE_OR_REFERENCE = /\\[!-/:-@[-`{-~]|&(?:#(?:\d{1,7}|x[\da-f]{1,6})|[\da-z]{1,31});/gi;

/**
 * The text of `source` from `start` to `end` as the parser reads it, with
 * escapes and character references decoded, and the offset in `source`
 * each of its characters comes from; one more offset marks the end.
 */
function decodeText(source: string, start: number, end: number): { text: string; offsets: number[] } {
  const raw = source.slice(start, end);
  let text = "";
  const offsets: number[] = [];
  let last = 0;
  const keep = (to: number) => {
    text += raw.slice(last, to);
    for (let i = last; i < to; i++) offsets.push(start + i);
  };
  for (const match of raw.matchAll(ESCAPE_OR_REFERENCE)) {
    const decoded = decodeString(match[0]);
    // An unknown name such as `&nope;` stays as written.
    if (decoded === match[0]) continue;
    keep(match.index);
    text += decoded;
    offsets.push(...new Array<number>(decoded.length).fill(start + match.index));
    last = match.index + match[0].length;
  }
  keep(raw.length);
  offsets.push(end);
  return { text, offsets };
}

function uniqueTitle(title: string, index: MoveContext["after"]): boolean {
  const normalized = normalizeTitle(title);
  return [...index.pagesByPath.values()].filter((page) => normalizeTitle(page.title) === normalized).length === 1;
}

const decode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

/** Escapes what would end or split a destination written without angle brackets. */
const escape = (path: string) =>
  path.replace(/[\s<>#?()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

/** The destination of `[text](destination)` or `![alt](destination)`; null for autolinks. */
function inlineDestination(source: string, start: number, end: number): Destination | null {
  const open = source[start] === "!" ? start + 1 : start;
  if (source[open] !== "[") return null;
  const close = closingBracket(source, open, end);
  return close >= 0 && source[close + 1] === "(" ? destinationAt(source, close + 2) : null;
}

/** The destination of `[label]: destination "title"`. */
function definitionDestination(source: string, start: number, end: number): Destination | null {
  const open = source.indexOf("[", start);
  const close = open < 0 ? -1 : closingBracket(source, open, end);
  return close >= 0 && source[close + 1] === ":" ? destinationAt(source, close + 2) : null;
}

/** The `]` that closes the `[` at `open`, skipping escapes, nested brackets and code spans. */
function closingBracket(source: string, open: number, end: number): number {
  let depth = 0;
  for (let i = open; i < end; i++) {
    const char = source[i];
    if (char === "\\") i++;
    else if (char === "`") {
      const run = /`+/y;
      run.lastIndex = i;
      const ticks = run.exec(source)![0];
      const closing = new RegExp(`(?<!\`)${ticks}(?!\`)`, "g");
      closing.lastIndex = i + ticks.length;
      const match = closing.exec(source);
      i = match && match.index < end ? match.index + ticks.length - 1 : i + ticks.length - 1;
    } else if (char === "[") depth++;
    else if (char === "]" && --depth === 0) return i;
  }
  return -1;
}

/** The destination starting after optional whitespace at `at`: `<…>`, or up to whitespace or an unbalanced `)`. */
function destinationAt(source: string, at: number): Destination | null {
  let i = at;
  while (/[ \t\r\n]/.test(source[i] ?? "")) i++;
  if (source[i] === "<") {
    const start = i + 1;
    for (i = start; i < source.length && source[i] !== ">" && source[i] !== "\n"; i++) if (source[i] === "\\") i++;
    return source[i] === ">" ? { start, end: i, angle: true } : null;
  }
  const start = i;
  for (let depth = 0; i < source.length; i++) {
    const char = source[i]!;
    if (char === "\\") i++;
    else if (char <= " ") break;
    else if (char === "(") depth++;
    else if (char === ")" && depth-- === 0) break;
  }
  return i > start ? { start, end: i, angle: false } : null;
}

/** Applies sorted, non-overlapping edits; each change names the line it starts on. */
function apply(source: string, edits: readonly Edit[], bom: string): { content: string; changes: LinkChange[] } {
  const changes: LinkChange[] = [];
  let content = bom;
  let last = 0;
  let line = 1;
  for (const edit of edits) {
    if (edit.start < last) continue;
    const skipped = source.slice(last, edit.start);
    line += skipped.split("\n").length - 1;
    changes.push({ line, before: source.slice(edit.start, edit.end), after: edit.text });
    content += skipped + edit.text;
    line += source.slice(edit.start, edit.end).split("\n").length - 1;
    last = edit.end;
  }
  return { content: content + source.slice(last), changes };
}
