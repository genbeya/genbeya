/**
 * Full-text search with `git grep` in one working tree: tracked files and
 * untracked ones that .gitignore does not exclude; binary files are skipped.
 * It works the same on every host, since only git runs. The pattern is an
 * argument of `-e`, so it never reads as an option.
 */
import { decodeLenient } from "../../utilities/bytes";
import { type Git, GitError } from "./git";

export interface GrepPattern {
  readonly text: string;
  /** An extended regular expression instead of literal text. */
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
}

const TIMEOUT = 20_000;
/** Paths per call stay well below the 32767 characters of a Windows command line. */
const PATH_BUDGET = 8_000;

const patternArgs = (pattern: GrepPattern): string[] => [
  "-I",
  "--untracked",
  pattern.regex ? "-E" : "-F",
  ...(pattern.caseSensitive ? [] : ["-i"]),
  ...(pattern.wholeWord ? ["-w"] : []),
  "-e",
  pattern.text,
];

async function grep(git: Git, args: readonly string[]): Promise<string> {
  const result = await git.run(["grep", ...args], TIMEOUT);
  // Exit code 1: nothing matched.
  if (result.code === 1) return "";
  if (result.code === 124) throw new GitError("The search took too long. Search for something more specific.");
  if (result.code !== 0)
    throw new GitError(result.stderr.replace(/^(fatal|error): /gm, "").trim() || `git grep failed with exit code ${result.code}.`);
  return decodeLenient(result.stdout);
}

/** The files with a match, in git's order. */
export async function grepFiles(git: Git, pattern: GrepPattern): Promise<string[]> {
  return (await grep(git, ["-l", "-z", ...patternArgs(pattern), "--"])).split("\0").filter(Boolean);
}

/** The matching lines of `paths`, each with `context` lines around it. */
export async function grepLines(git: Git, pattern: GrepPattern, paths: readonly string[], context = 1): Promise<GrepLine[]> {
  const lines: GrepLine[] = [];
  for (const chunk of chunks(paths)) {
    const output = await grep(git, ["-n", "--column", "-z", `-C${context}`, ...patternArgs(pattern), "--", ...chunk]);
    lines.push(...parseGrepLines(output));
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
 * from context lines. Hunks are separated by `--` lines.
 */
export function parseGrepLines(output: string): GrepLine[] {
  const lines: GrepLine[] = [];
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
    lines.push({
      path: output.slice(at, end),
      line: Number(record[1]),
      text: record[3]!.replace(/\r$/, ""),
      match: record[2] !== undefined,
    });
    at = RECORD.lastIndex;
  }
  return lines;
}
