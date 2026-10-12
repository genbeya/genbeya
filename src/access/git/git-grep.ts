/**
 * Full-text search with `git grep` in one working tree: tracked files and
 * untracked ones that .gitignore does not exclude; binary files are skipped.
 * It works the same on every host, since only git runs. The pattern is an
 * argument of `-e`, so it never reads as an option. Regular expressions are
 * Perl-compatible where the host's git has PCRE (Git for Windows and most
 * distributions do), else POSIX extended ones.
 *
 * Git also says where the pattern matches in a line: a regular expression
 * never runs in Genbeya itself, where a pathological one would block every
 * repository, and it means exactly what it meant to git.
 */
import type { SearchRange } from "../../contracts/model";
import { decodeLenient } from "../../utilities/bytes";
import { TIMED_OUT, TOO_MUCH_OUTPUT } from "../ports";
import { type Git, GitError } from "./git";

export interface GrepPattern {
  readonly text: string;
  /** A regular expression instead of literal text. */
  readonly regex: boolean;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
}

export interface GrepLine {
  readonly path: string;
  readonly line: number;
  readonly text: string;
  /** False for a line of context around a match. */
  readonly match: boolean;
  /** Where the pattern matches in `text`; empty for context lines, and where git could not say. */
  readonly ranges: readonly SearchRange[];
}

const TIMEOUT = 20_000;
/** Paths per call stay well below the 32767 characters of a Windows command line. */
const PATH_BUDGET = 8_000;
/** Occurrences per line that get a range. */
const RANGES_PER_LINE = 50;
const TOO_LONG = "The search took too long. Search for something more specific.";
const TOO_MANY = "The search found too much to show. Search for something more specific.";

/** Repositories whose git is older than 2.38, which has no `--max-count` for grep; their output is cut while parsing. */
const withoutMaxCount = new WeakSet<Git>();
/** Hosts whose git was built without PCRE; they search with extended regular expressions. */
const withoutPerl = new WeakSet<object>();

const patternArgs = (pattern: GrepPattern, perl: boolean): string[] => [
  "-I",
  "--untracked",
  !pattern.regex ? "-F" : perl ? "-P" : "-E",
  ...(pattern.caseSensitive ? [] : ["-i"]),
  ...(pattern.wholeWord ? ["-w"] : []),
  "-e",
  pattern.text,
];

/**
 * Runs `git grep` with `options` for `pattern` in `paths` (all files when
 * none are given), with at most `limit` matching lines per file where git
 * supports that.
 */
async function grep(
  git: Git,
  pattern: GrepPattern,
  options: readonly string[],
  paths: readonly string[] = [],
  limit?: number,
): Promise<string> {
  const capped = limit !== undefined && !withoutMaxCount.has(git);
  const perl = pattern.regex && !withoutPerl.has(git.host);
  const started = Date.now();
  let result;
  try {
    const args = ["grep", ...(capped ? [`--max-count=${limit}`] : []), ...options, ...patternArgs(pattern, perl), "--", ...paths];
    result = await git.run(args, TIMEOUT);
  } catch (error) {
    // Hosts reached through a shell session report a timeout as an error.
    if (Date.now() - started >= TIMEOUT) throw new GitError(TOO_LONG);
    throw error;
  }
  if (capped && result.code === 129 && /unknown (option|switch)/.test(result.stderr)) {
    withoutMaxCount.add(git);
    return grep(git, pattern, options, paths, limit);
  }
  if (perl && result.code === 128 && /USE_LIBPCRE|Perl-compatible/i.test(result.stderr)) {
    withoutPerl.add(git.host);
    return grep(git, pattern, options, paths, limit);
  }
  // Exit code 1: nothing matched.
  if (result.code === 1) return "";
  if (result.code === TIMED_OUT) throw new GitError(TOO_LONG);
  if (result.code === TOO_MUCH_OUTPUT) throw new GitError(TOO_MANY);
  // PCRE gives up on patterns that backtrack too much, such as (a+)+b, instead of running for ages.
  if (perl && /match limit|depth limit|recursion limit/i.test(result.stderr))
    throw new GitError("This regular expression takes too long to match. Search for something more specific.");
  // "fatal: -e option, '(a': missing closing parenthesis"
  const invalid = `fatal: -e option, '${pattern.text}': `;
  if (pattern.regex && result.stderr.startsWith(invalid))
    throw new GitError(`Invalid regular expression: ${result.stderr.slice(invalid.length).trim().replace(/\.?$/, ".")}`);
  if (result.code !== 0)
    throw new GitError(result.stderr.replace(/^(fatal|error): /gm, "").trim() || `git grep failed with exit code ${result.code}.`);
  return decodeLenient(result.stdout);
}

/** The files with a match, in git's order. */
export async function grepFiles(git: Git, pattern: GrepPattern): Promise<string[]> {
  return (await grep(git, pattern, ["-l", "-z"])).split("\0").filter(Boolean);
}

/**
 * The matching lines of `paths`, at most `limit` per file, each with
 * `context` lines around it and the ranges git matched in it.
 */
export async function grepLines(git: Git, pattern: GrepPattern, paths: readonly string[], limit: number, context = 1): Promise<GrepLine[]> {
  const lines: GrepLine[] = [];
  for (const chunk of chunks(paths)) {
    const output = await grep(git, pattern, ["-n", "--column", "-z", `-C${context}`], chunk, limit);
    const found = parseGrepLines(output, limit, context);
    if (!found.length) continue;
    // Ranges only highlight; a line without them still counts.
    const parts = await grep(git, pattern, ["-n", "--column", "-z", "-o"], chunk, limit).catch(() => "");
    lines.push(...withRanges(found, parseGrepParts(parts), pattern.wholeWord));
  }
  return lines;
}

function chunks(paths: readonly string[]): string[][] {
  const result: string[][] = [];
  let length = Infinity;
  for (const path of paths) {
    if (length + path.length > PATH_BUDGET) {
      result.push([]);
      length = 0;
    }
    result.at(-1)!.push(path);
    length += path.length + 3;
  }
  return result;
}

/** One line after its path: `line\0column\0text` for a match, `line\0text` for context. */
const RECORD = /(\d+)\0(?:(\d+)\0)?([^\n]*)(?:\n|$)/y;

/**
 * Parses `git grep -n --column -z -C<n>` output. Paths end at the NUL, so
 * any file name survives; only matches carry a column, which tells them
 * from context lines. Hunks are separated by `--` lines. Past `limit`
 * matches of a file, only the context after the last one is kept.
 */
export function parseGrepLines(output: string, limit = Infinity, context = 1): GrepLine[] {
  const lines: GrepLine[] = [];
  const kept = new Map<string, { count: number; last: number }>();
  let at = 0;
  while (at < output.length) {
    if (output.startsWith("--\n", at)) {
      at += 3;
      continue;
    }
    const end = output.indexOf("\0", at);
    if (end < 0) break;
    RECORD.lastIndex = end + 1;
    const record = RECORD.exec(output);
    if (!record) break;
    const path = output.slice(at, end);
    const line = Number(record[1]);
    const match = record[2] !== undefined;
    at = RECORD.lastIndex;
    const file = kept.get(path) ?? { count: 0, last: 0 };
    kept.set(path, file);
    if (file.count === limit && (match || line > file.last + context)) continue;
    if (match) {
      file.count++;
      file.last = line;
    }
    lines.push({ path, line, text: record[3]!.replace(/\r$/, ""), match, ranges: [] });
  }
  return lines;
}

/** One matched part: `line\0column\0text`, the column counting bytes from 1. */
const PART = /(\d+)\0(\d+)\0([^\n]*)(?:\n|$)/y;

interface Part {
  readonly byte: number;
  readonly text: string;
}

/** Parses `git grep -n --column -z -o` output: the matched parts of each line, by path and line. */
export function parseGrepParts(output: string): Map<string, Map<number, Part[]>> {
  const parts = new Map<string, Map<number, Part[]>>();
  let at = 0;
  while (at < output.length) {
    const end = output.indexOf("\0", at);
    if (end < 0) break;
    PART.lastIndex = end + 1;
    const record = PART.exec(output);
    if (!record) break;
    const path = output.slice(at, end);
    at = PART.lastIndex;
    const byLine = parts.get(path) ?? new Map<number, Part[]>();
    parts.set(path, byLine);
    const line = Number(record[1]);
    const found = byLine.get(line) ?? [];
    byLine.set(line, found);
    if (found.length < RANGES_PER_LINE) found.push({ byte: Number(record[2]) - 1, text: record[3]!.replace(/\r$/, "") });
  }
  return parts;
}

/** Characters git counts as part of a word for -w. */
const WORD = /^[A-Za-z0-9_]$/;

const utf8Length = (point: number) => (point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4);

/** The matching lines with the ranges of their parts. */
function withRanges(lines: readonly GrepLine[], parts: Map<string, Map<number, Part[]>>, wholeWord: boolean): GrepLine[] {
  return lines.map((line) => {
    const found = line.match ? parts.get(line.path)?.get(line.line) : undefined;
    return found ? { ...line, ranges: rangesOf(line.text, found, wholeWord) } : line;
  });
}

/**
 * Where the `parts` git matched lie in `text`, in UTF-16 code units; git
 * counts bytes. Git (at least up to 2.53) gives the true column only for a
 * line's first part; for each later one it adds where its search resumed,
 * the end of the part before, to that first column. Both readings are
 * checked against the text, and a part neither places is looked for after
 * the one before.
 */
function rangesOf(text: string, parts: readonly Part[], wholeWord: boolean): SearchRange[] {
  const ranges: SearchRange[] = [];
  const first = parts[0]?.byte ?? 0;
  // The end of the last range, in both units.
  let byte = 0;
  let index = 0;
  parts.forEach((part, k) => {
    if (!part.text) return;
    const length = byteLength(part.text);
    const next = parts[k + 1];
    const readings = k === 0 ? [part.byte] : [...(next ? [next.byte - first - length] : []), part.byte];
    let start = -1;
    for (const reading of readings) {
      const at = indexAt(text, index, byte, reading);
      if (at >= 0 && text.startsWith(part.text, at)) {
        start = at;
        break;
      }
    }
    if (start < 0) {
      const from = indexAt(text, index, byte, Math.max(byte, part.byte - first));
      start = from < 0 ? -1 : text.indexOf(part.text, from);
      // Git matches leftmost, so the first occurrence is the part, except inside a word with -w.
      while (start >= 0 && wholeWord && (WORD.test(text[start - 1] ?? "") || WORD.test(text[start + part.text.length] ?? "")))
        start = text.indexOf(part.text, start + 1);
    }
    if (start < 0) return;
    byte += byteLength(text.slice(index, start)) + length;
    index = start + part.text.length;
    ranges.push({ start, end: index });
  });
  return ranges;
}

const byteLength = (text: string) => {
  let length = 0;
  for (const char of text) length += utf8Length(char.codePointAt(0)!);
  return length;
};

/** The index of byte offset `target`, scanning from `index` at byte offset `byte`; -1 before it, inside a character or past the end. */
function indexAt(text: string, index: number, byte: number, target: number): number {
  if (target < byte) return -1;
  while (byte < target && index < text.length) {
    const point = text.codePointAt(index)!;
    byte += utf8Length(point);
    index += point > 0xffff ? 2 : 1;
  }
  return byte === target ? index : -1;
}
