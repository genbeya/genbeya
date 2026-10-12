/**
 * Rename detection, as Git's `-M`: a deleted and an added file are one
 * renamed file when at least half of their content is the same. Exact
 * copies pair first, then the most similar.
 */
import { splitLines } from "./line-diff";

export interface Rename {
  readonly from: string;
  readonly to: string;
}

const THRESHOLD = 0.5;

/** How much of two texts is the same: shared lines over the lines of the larger, from 0 to 1. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const left = splitLines(a);
  const right = splitLines(b);
  if (!left.length || !right.length) return 0;
  const counts = new Map<string, number>();
  for (const line of left) counts.set(line, (counts.get(line) ?? 0) + 1);
  let shared = 0;
  for (const line of right) {
    const count = counts.get(line) ?? 0;
    if (count) {
      shared++;
      counts.set(line, count - 1);
    }
  }
  return shared / Math.max(left.length, right.length);
}

/** Pairs of deleted and added files (content by path) that are renames. */
export function detectRenames(deleted: ReadonlyMap<string, string>, added: ReadonlyMap<string, string>): Rename[] {
  const candidates: (Rename & { score: number })[] = [];
  for (const [from, before] of deleted)
    for (const [to, after] of added) {
      const score = similarity(before, after);
      if (score >= THRESHOLD) candidates.push({ from, to, score });
    }
  candidates.sort((a, b) => b.score - a.score || (a.to < b.to ? -1 : 1));
  const used = new Set<string>();
  const renames: Rename[] = [];
  for (const { from, to } of candidates) {
    if (used.has(`-${from}`) || used.has(`+${to}`)) continue;
    used.add(`-${from}`).add(`+${to}`);
    renames.push({ from, to });
  }
  return renames;
}
