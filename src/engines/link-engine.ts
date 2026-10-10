/**
 * Links between Markdown files when wiki pages move. Relative links and
 * `[[references]]` that point into the moved pages are pointed at their new
 * paths, and relative links inside the moved pages at the same targets as
 * before. Only link destinations and reference targets change, written the
 * way they were (relative or absolute, title or path, with or without `.md`,
 * encoded or not); code, and every other byte, stays as it is.
 */
import type { Nodes } from "mdast";
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
    // The path of a destination changes; its `#anchor` stays.
    const destination = (span: Destination | null) => {
      if (!span) return;
      const written = source.slice(span.start, span.end).split("#", 1)[0]!;
      const text = written && this.destination(written, span.angle, path, context.moves);
      if (text) edits.push({ start: span.start, end: span.start + written.length, text });
    };
    visit(parser.parse(source), (node: Nodes, _index, parent) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      if (node.type === "link" || node.type === "image") destination(inlineDestination(source, start, end));
      else if (node.type === "definition") destination(definitionDestination(source, start, end));
      // References in a link's text are plain text, like the renderer shows them.
      else if (node.type === "text" && parent?.type !== "link")
        for (const match of source.slice(start, end).matchAll(WIKILINK)) {
          const target = match[1]!;
          const name = target.trim().split("#", 1)[0]!;
          const text = this.reference(target, name, context);
          const at = start + match.index + 2 + (target.length - target.trimStart().length);
          if (text !== null) edits.push({ start: at, end: at + name.length, text });
        }
    });
    return edits.sort((a, b) => a.start - b.start);
  }

  /** The new path of a Markdown link in `home`, or null when it still points to the same place. */
  private destination(written: string, angle: boolean, home: string, moves: MoveContext["moves"]): string | null {
    if (EXTERNAL.test(written)) return null;
    const decoded = decode(written.replace(/\\([!-/:-@[-`{-~])/g, "$1"));
    const target = resolveLinkPath(home, decoded);
    const newTarget = movedTarget(target, moves) ?? target;
    const newHome = relocate(home, moves) ?? home;
    if (resolveLinkPath(newHome, decoded) === newTarget) return null;
    let path = decoded.startsWith("/") ? `/${newTarget}` : relativeLinkPath(newHome, newTarget);
    if (decoded.startsWith("./") && !path.startsWith("../")) path = `./${path}`;
    return angle ? path.replace(/[<>\\]/g, "\\$&") : escape(/%[0-9a-f]{2}/i.test(written) ? encodeURI(path) : path);
  }

  /** The new name in `[[target]]`, or null when the reference still works. */
  private reference(target: string, name: string, { moves, before, after }: MoveContext): string | null {
    const found = findReference(target, before);
    const prefix = /^\/*/.exec(name)![0];
    if (found.kind === "file") {
      const path = relocate(found.path, moves);
      return path && prefix + path;
    }
    if (found.kind !== "page") return null;
    const path = relocate(found.page.path, moves);
    const page = path ? after.pagesByPath.get(path.toLowerCase()) : undefined;
    if (!page || (found.style === "title" && normalizeTitle(page.title) === normalizeTitle(name))) return null;
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

/** Where a link target is after the move; a link may leave out the `.md` of a page. */
function movedTarget(path: string, moves: MoveContext["moves"]): string | null {
  return relocate(path, moves) ?? (baseName(path).includes(".") ? null : (relocate(`${path}.md`, moves)?.slice(0, -3) ?? null));
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
