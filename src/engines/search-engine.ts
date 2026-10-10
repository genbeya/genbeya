/**
 * The rules of full-text search: what a valid query is, which area a file
 * belongs to, where a query matches in a line, and how long lines are
 * shortened around the match. Git finds the lines; this decides how they read.
 */
import type { SearchArea, SearchRange, Settings } from "../contracts/model";
import { within } from "../utilities/repository-path";
import { isTaskFile } from "./task-engine";

export const SEARCH_LIMITS = {
  /** Characters of a query. */
  query: 200,
  /** Files listed per area. */
  filesPerArea: 30,
  /** Matches listed per file. */
  matchesPerFile: 10,
  /** Characters shown of a line. */
  lineLength: 200,
} as const;

/** Characters kept before the first match when a long line is shortened. */
const LEAD = 40;
/** Highlighted occurrences per line. */
const RANGES_PER_LINE = 50;
const WORD = "[A-Za-z0-9_]";
const FLAGS = ["caseSensitive", "regex", "wholeWord"] as const;

export interface SearchQuery {
  readonly text: string;
  readonly caseSensitive: boolean;
  readonly regex: boolean;
  readonly wholeWord: boolean;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isMarkdown = (path: string) => path.toLowerCase().endsWith(".md");

export class SearchEngine {
  validate(text: unknown, options: unknown): SearchQuery {
    if (typeof text !== "string" || !text.trim()) throw new Error("Enter text to search for.");
    if (text.length > SEARCH_LIMITS.query) throw new Error(`Search for at most ${SEARCH_LIMITS.query} characters.`);
    // git reads a pattern with line breaks as several patterns.
    if (/[\r\n\0]/.test(text)) throw new Error("Search for text within one line.");
    const given = options ?? {};
    if (typeof given !== "object" || Array.isArray(given)) throw new Error("Invalid search options.");
    const flags = given as Partial<Record<(typeof FLAGS)[number], unknown>>;
    if (FLAGS.some((flag) => flags[flag] !== undefined && typeof flags[flag] !== "boolean")) throw new Error("Invalid search options.");
    return { text, caseSensitive: flags.caseSensitive === true, regex: flags.regex === true, wholeWord: flags.wholeWord === true };
  }

  /** Tasks and pages are Markdown files below their folders; everything else, task templates included, is code. */
  areaOf(path: string, settings: Pick<Settings, "wikiRoot" | "taskRoot">): SearchArea {
    if (isTaskFile(path, settings.taskRoot)) return "tasks";
    if (isMarkdown(path) && within(path, settings.wikiRoot)) return "wiki";
    return "code";
  }

  /**
   * Where `query` matches in a line. Regular expressions are git's extended
   * ones; where JavaScript reads one differently or not at all, a line git
   * matched simply has no ranges.
   */
  matcher(query: SearchQuery): (line: string) => SearchRange[] {
    const source = query.regex ? query.text : escapeRegExp(query.text);
    let pattern: RegExp;
    try {
      pattern = new RegExp(query.wholeWord ? `(?<!${WORD})(?:${source})(?!${WORD})` : source, query.caseSensitive ? "g" : "gi");
    } catch {
      return () => [];
    }
    return (line) => {
      const ranges: SearchRange[] = [];
      for (const match of line.matchAll(pattern)) {
        if (!match[0]) continue;
        ranges.push({ start: match.index, end: match.index + match[0].length });
        if (ranges.length === RANGES_PER_LINE) break;
      }
      return ranges;
    };
  }

  /** A long line shortened to the limit with "…", keeping the first match and some text before it. */
  excerpt(line: string, ranges: readonly SearchRange[]): { text: string; ranges: SearchRange[] } {
    const limit = SEARCH_LIMITS.lineLength;
    if (line.length <= limit) return { text: line, ranges: [...ranges] };
    const start = Math.max(0, Math.min((ranges[0]?.start ?? 0) - LEAD, line.length - limit));
    const end = start + limit;
    const prefix = start > 0 ? "…" : "";
    const shift = prefix.length - start;
    return {
      text: prefix + line.slice(start, end) + (end < line.length ? "…" : ""),
      ranges: ranges
        .filter((range) => range.start < end && range.end > start)
        .map((range) => ({ start: Math.max(range.start, start) + shift, end: Math.min(range.end, end) + shift })),
    };
  }
}
