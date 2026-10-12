/**
 * Three-way merges of text files, as Git merges them: changes of one side
 * go in; where both sides changed the same or neighbouring lines of the
 * common ancestor differently, the file gets conflict markers in Git's
 * merge style, shrunk to the lines that differ.
 */
import { diffLines, splitLines, type LineChange } from "./line-diff";

export interface MergeLabels {
  /** What the markers call the current side, such as "HEAD". */
  readonly ours: string;
  /** And the incoming one, such as the merged branch. */
  readonly theirs: string;
}

export interface MergeResult {
  readonly text: string;
  /** Conflicted hunks; 0 for a clean merge. */
  readonly conflicts: number;
}

/** Lines of the ancestor from `start` to `end` that the changes of one side touch, and those changes. */
interface Region {
  start: number;
  end: number;
  readonly ours: LineChange[];
  readonly theirs: LineChange[];
}

/** One side's lines for the ancestor's lines `start` to `end`, with its changes applied. */
function sideOf(base: readonly string[], side: readonly string[], changes: readonly LineChange[], start: number, end: number): string[] {
  const lines: string[] = [];
  let at = start;
  for (const change of changes) {
    lines.push(...base.slice(at, change.aStart), ...side.slice(change.bStart, change.bEnd));
    at = change.aEnd;
  }
  return [...lines, ...base.slice(at, end)];
}

/** Lines ending in a line break, so a marker after them starts a line of its own. */
const terminated = (lines: readonly string[]) => lines.map((line) => (line.endsWith("\n") ? line : `${line}\n`));

export function mergeText(base: string, ours: string, theirs: string, labels: MergeLabels): MergeResult {
  if (ours === theirs || base === theirs) return { text: ours, conflicts: 0 };
  if (base === ours) return { text: theirs, conflicts: 0 };
  const [o, a, b] = [splitLines(base), splitLines(ours), splitLines(theirs)];
  const changes = [
    ...diffLines(o, a).map((change) => ({ change, side: "ours" as const })),
    ...diffLines(o, b).map((change) => ({ change, side: "theirs" as const })),
  ].sort((x, y) => x.change.aStart - y.change.aStart || x.change.aEnd - y.change.aEnd);

  // Changes that overlap or touch, in the ancestor's lines, belong to one region; Git merges them alike.
  const regions: Region[] = [];
  for (const { change, side } of changes) {
    const last = regions.at(-1);
    if (last && change.aStart <= last.end) {
      last.end = Math.max(last.end, change.aEnd);
      last[side].push(change);
    } else {
      const region: Region = { start: change.aStart, end: change.aEnd, ours: [], theirs: [] };
      region[side].push(change);
      regions.push(region);
    }
  }

  const text: string[] = [];
  let conflicts = 0;
  let at = 0;
  for (const region of regions) {
    text.push(...o.slice(at, region.start));
    at = region.end;
    const mine = sideOf(o, a, region.ours, region.start, region.end);
    const incoming = sideOf(o, b, region.theirs, region.start, region.end);
    if (!region.theirs.length || mine.join("") === incoming.join("")) text.push(...mine);
    else if (!region.ours.length) text.push(...incoming);
    else {
      // Lines both sides start or end with stay outside the markers.
      let head = 0;
      while (head < mine.length && head < incoming.length && mine[head] === incoming[head]) head++;
      let tail = 0;
      while (
        tail < mine.length - head &&
        tail < incoming.length - head &&
        mine[mine.length - 1 - tail] === incoming[incoming.length - 1 - tail]
      )
        tail++;
      conflicts++;
      text.push(
        ...mine.slice(0, head),
        `<<<<<<< ${labels.ours}\n`,
        ...terminated(mine.slice(head, mine.length - tail)),
        "=======\n",
        ...terminated(incoming.slice(head, incoming.length - tail)),
        `>>>>>>> ${labels.theirs}\n`,
        ...mine.slice(mine.length - tail),
      );
    }
  }
  text.push(...o.slice(at));
  return { text: text.join(""), conflicts };
}
