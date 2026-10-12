/**
 * One file's diff in Git's unified format, as `git diff` prints it with
 * Genbeya's diff options: `a/` and `b/` prefixes, three lines of context,
 * hunks joined only where their context would overlap. The patch engine
 * reads it as it reads Git's.
 */
import { diffLines, splitLines, type LineChange } from "./line-diff";

const CONTEXT = 3;
const NO_NEWLINE = "\\ No newline at end of file";

/** A hunk's header numbers: a side without lines names the line it comes after, and a count of one is left out. */
function range(start: number, count: number): string {
  if (count === 0) return `${start},0`;
  return count === 1 ? `${start + 1}` : `${start + 1},${count}`;
}

/** The change runs grouped into hunks: runs closer than twice the context share one. */
function group(changes: readonly LineChange[]): LineChange[][] {
  const hunks: LineChange[][] = [];
  for (const change of changes) {
    const last = hunks.at(-1);
    if (last && change.aStart - last.at(-1)!.aEnd <= 2 * CONTEXT) last.push(change);
    else hunks.push([change]);
  }
  return hunks;
}

/** A line of the diff, with Git's note after one that ends its version without a line break. */
const row = (marker: string, line: string) => (line.endsWith("\n") ? `${marker}${line}` : `${marker}${line}\n${NO_NEWLINE}\n`);

/**
 * The diff of one file from `before` to `after`; `null` paths mean the file
 * is created or deleted. Empty when nothing changed.
 */
export function unifiedDiff(oldPath: string | null, newPath: string | null, before: string, after: string): string {
  const a = splitLines(before);
  const b = splitLines(after);
  const changes = diffLines(a, b);
  if (!changes.length && oldPath !== null && newPath !== null) return "";
  const name = (newPath ?? oldPath)!;
  const text = [
    `diff --git a/${oldPath ?? name} b/${name}\n`,
    oldPath === null ? "new file mode 100644\n" : "",
    newPath === null ? "deleted file mode 100644\n" : "",
    `--- ${oldPath === null ? "/dev/null" : `a/${oldPath}`}\n`,
    `+++ ${newPath === null ? "/dev/null" : `b/${newPath}`}\n`,
  ];
  for (const hunk of group(changes)) {
    const first = hunk[0]!;
    const last = hunk.at(-1)!;
    const aStart = Math.max(0, first.aStart - CONTEXT);
    const aEnd = Math.min(a.length, last.aEnd + CONTEXT);
    const bStart = first.bStart - (first.aStart - aStart);
    const bEnd = last.bEnd + (aEnd - last.aEnd);
    text.push(`@@ -${range(aStart, aEnd - aStart)} +${range(bStart, bEnd - bStart)} @@\n`);
    let at = aStart;
    for (const change of hunk) {
      for (; at < change.aStart; at++) text.push(row(" ", a[at]!));
      for (let i = change.aStart; i < change.aEnd; i++) text.push(row("-", a[i]!));
      for (let i = change.bStart; i < change.bEnd; i++) text.push(row("+", b[i]!));
      at = change.aEnd;
    }
    for (; at < aEnd; at++) text.push(row(" ", a[at]!));
  }
  return text.join("");
}
