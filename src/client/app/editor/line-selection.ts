/**
 * Which changed lines of a diff the user chose: from the chunks of the
 * merge view and the lines selected in its editors, the removed lines (by
 * number in the original) and added lines (in the modified version) to
 * stage, unstage or discard.
 */
import type { Chunk } from "@codemirror/merge";
import type { SelectionRange, Text } from "@codemirror/state";
import type { LineRange, LineSelection } from "../../../contracts/model";

/** The lines a chunk of a diff covers in each version. */
export interface ChunkLines {
  /** Removed lines; null when the chunk removes nothing. */
  readonly original: LineRange | null;
  /** Added lines; null when the chunk adds nothing. */
  readonly modified: LineRange | null;
  /** The line of the modified version where the chunk starts; below a removal. */
  readonly at: number;
}

export function chunkLines(chunk: Chunk, a: Text, b: Text): ChunkLines {
  const lines = (doc: Text, from: number, to: number, end: number) =>
    from === to ? null : { from: doc.lineAt(from).number, to: doc.lineAt(end).number };
  return {
    original: lines(a, chunk.fromA, chunk.toA, chunk.endA),
    modified: lines(b, chunk.fromB, chunk.toB, chunk.endB),
    at: b.lineAt(Math.min(chunk.fromB, b.length)).number,
  };
}

/** All lines of a chunk, for its hunk actions. */
export const wholeChunk = (chunk: ChunkLines): LineSelection => ({
  original: chunk.original ? [chunk.original] : [],
  modified: chunk.modified ? [chunk.modified] : [],
});

/** The lines selections cover; cursors cover none, and a selection ending at a line's start leaves that line out. */
export function selectedLines(doc: Text, ranges: readonly SelectionRange[]): LineRange[] {
  return ranges
    .filter((range) => !range.empty)
    .map((range) => {
      const last = doc.lineAt(range.to);
      return { from: doc.lineAt(range.from).number, to: last.from === range.to && range.to > range.from ? last.number - 1 : last.number };
    });
}

const overlap = (range: LineRange, selected: readonly LineRange[]): LineRange[] =>
  selected
    .map((part) => ({ from: Math.max(part.from, range.from), to: Math.min(part.to, range.to) }))
    .filter((part) => part.from <= part.to);

const includes = (selected: readonly LineRange[], line: number) => selected.some((part) => part.from <= line && line <= part.to);

/** Sorted, without overlaps. */
function merged(ranges: readonly LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.from - b.from);
  const result: LineRange[] = [];
  for (const range of sorted) {
    const last = result.at(-1);
    if (last && range.from <= last.to + 1) result[result.length - 1] = { from: last.from, to: Math.max(last.to, range.to) };
    else result.push(range);
  }
  return result;
}

const size = (ranges: readonly LineRange[]) => ranges.reduce((total, range) => total + range.to - range.from + 1, 0);

/**
 * The changed lines among those selected: removals selected in the original
 * and additions selected in the modified version. Removed lines also go
 * along once all lines replacing them are selected, and a removal that
 * adds nothing once the selection touches a line next to it, since the
 * modified version shows no lines of its own there. Null when no changed
 * line is selected.
 */
export function chosenLines(
  chunks: readonly ChunkLines[],
  original: readonly LineRange[],
  modified: readonly LineRange[],
): LineSelection | null {
  const removed: LineRange[] = [];
  const added: LineRange[] = [];
  for (const chunk of chunks) {
    if (chunk.original) removed.push(...overlap(chunk.original, original));
    if (chunk.modified) {
      const lines = merged(overlap(chunk.modified, modified));
      added.push(...lines);
      if (chunk.original && size(lines) === chunk.modified.to - chunk.modified.from + 1) removed.push(chunk.original);
    } else if (chunk.original && (includes(modified, chunk.at) || includes(modified, chunk.at - 1))) removed.push(chunk.original);
  }
  return removed.length || added.length ? { original: merged(removed), modified: merged(added) } : null;
}
