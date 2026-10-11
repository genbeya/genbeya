/**
 * Showing a diff with git's changes. CodeMirror finds changes its own way,
 * and with repeated lines (braces, blank lines) may place one elsewhere
 * than git does, whose diff the backend patches when staging. From git's
 * runs of changed lines, a diff for the merge view whose chunks cover the
 * lines git changed, the runs in each chunk, and git's numbers for the
 * editors' lines, which also break lines at lone carriage returns.
 */
import { Change, Chunk, diff, type DiffConfig } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import type { DiffChange, LineRange } from "../../../contracts/model";
import type { ChunkLines } from "./line-selection";

/** Changed text longer than this is marked as whole lines, without looking for the changed words. */
const WORD_DIFF_LIMIT = 5000;

/** Where git's lines of a text start in an editor showing it. */
export class GitLines {
  /** Editor positions of the starts of git's lines, then of the document's end. */
  private readonly starts: number[] = [0];

  constructor(text: string) {
    let position = 0;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      // The editor keeps a Windows line break as one character.
      if (code === 13 && text.charCodeAt(i + 1) === 10) continue;
      position++;
      if (code === 10) this.starts.push(position);
    }
    if (text !== "" && !text.endsWith("\n")) this.starts.push(position);
  }

  /** The editor position where git's line `line` (1-based) starts; the end of the document after the last line. */
  start(line: number): number {
    return this.starts[Math.min(Math.max(line, 1), this.starts.length) - 1]!;
  }

  /** Git's line at editor position `position`; the last line for the empty line the editor shows after a final line break. */
  lineAt(position: number): number {
    let [low, high] = [0, this.starts.length - 2];
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if (this.starts[middle]! <= position) low = middle;
      else high = middle - 1;
    }
    return Math.max(low, 0) + 1;
  }

  /** Git's lines for the lines `ranges` of the editor's document `doc`. */
  lines(doc: Text, ranges: readonly LineRange[]): LineRange[] {
    return ranges.map((range) => ({ from: this.lineAt(doc.line(range.from).from), to: this.lineAt(doc.line(range.to).from) }));
  }
}

/** A run of changed lines, by editor positions: from the start of its first line to the start of the line after it. */
interface Span {
  readonly fromA: number;
  readonly toA: number;
  readonly fromB: number;
  readonly toB: number;
}

/**
 * A change as CodeMirror leaves it. It moves insertions and deletions
 * longer than three characters to where they read better, which with
 * repeated lines is another line than git's, and merges changes that
 * touch: in pieces that short, it merges them back where they were.
 */
function unmoved(fromA: number, toA: number, fromB: number, toB: number): Change[] {
  if (fromA !== toA && fromB !== toB) return [new Change(fromA, toA, fromB, toB)];
  const pieces: Change[] = [];
  for (let a = fromA, b = fromB; a < toA || b < toB; a = Math.min(a + 3, toA), b = Math.min(b + 3, toB))
    pieces.push(new Change(a, Math.min(a + 3, toA), b, Math.min(b + 3, toB)));
  return pieces;
}

/**
 * Ways to tell CodeMirror about a run, tried in turn until its chunks cover
 * the run's lines: the changed words, the whole lines, and the whole lines
 * from the line break before them (CodeMirror starts a chunk at the line
 * after a change that starts at the end of a line).
 */
const ENCODINGS: readonly ((span: Span, a: string, b: string) => Change[] | null)[] = [
  ({ fromA, toA, fromB, toB }, a, b) => {
    if (fromA === toA || fromB === toB || toA - fromA + toB - fromB > WORD_DIFF_LIMIT) return null;
    const words = diff(a.slice(fromA, toA), b.slice(fromB, toB));
    return words.length
      ? words.map((word) => new Change(word.fromA + fromA, word.toA + fromA, word.fromB + fromB, word.toB + fromB))
      : null;
  },
  ({ fromA, toA, fromB, toB }) => unmoved(fromA, toA, fromB, toB),
  ({ fromA, toA, fromB, toB }, a, b) => {
    if (!fromA || !fromB) return null;
    // An empty side stays empty; a last line without a line break ends the document.
    const end = (text: string, from: number, to: number) => (to === from || text[to - 1] === "\n" ? to - 1 : to);
    return unmoved(fromA - 1, end(a, fromA, toA), fromB - 1, end(b, fromB, toB));
  },
];

/** Git's changes of a diff, for a merge view showing `original` and `modified`. */
export class GitChanges {
  readonly a: GitLines;
  readonly b: GitLines;
  /** Git's runs, by git's line numbers. */
  readonly runs: readonly ChunkLines[];
  /** For the merge view: CodeMirror's chunks at git's lines. */
  readonly config: DiffConfig;
  private readonly spans: readonly Span[];

  constructor(changes: readonly DiffChange[], original: string, modified: string) {
    this.a = new GitLines(original);
    this.b = new GitLines(modified);
    const range = (start: number, count: number) => (count ? { from: start, to: start + count - 1 } : null);
    this.runs = changes.map((change) => ({
      original: range(change.oldStart, change.oldCount),
      modified: range(change.newStart, change.newCount),
      at: change.newStart,
    }));
    this.spans = changes.map((change) => ({
      fromA: this.a.start(change.oldStart),
      toA: this.a.start(change.oldStart + change.oldCount),
      fromB: this.b.start(change.newStart),
      toB: this.b.start(change.newStart + change.newCount),
    }));
    this.config = { override: (a, b) => this.diff(a, b) };
  }

  /**
   * Git's runs in each of `chunks`: those it covers, and each other run in
   * the chunk next to it. Only a run CodeMirror cannot show at git's lines
   * is not covered: an empty line added before an empty first line.
   */
  runsIn(chunks: readonly Chunk[]): ChunkLines[][] {
    const runs = chunks.map((): ChunkLines[] => []);
    if (!chunks.length) return runs;
    const distance = (span: Span, chunk: Chunk) =>
      chunk.fromA <= span.fromA && span.toA <= chunk.toA && chunk.fromB <= span.fromB && span.toB <= chunk.toB
        ? -1
        : Math.max(chunk.fromB - span.toB, span.fromB - chunk.toB, 0);
    let next = 0;
    this.spans.forEach((span, index) => {
      // Both are in order: only the chunks around the first one that does not end before the run are candidates.
      while (next < chunks.length - 1 && chunks[next]!.toA < span.fromA && chunks[next]!.toB < span.fromB) next++;
      const candidates = [next - 1, next, next + 1].filter((i) => i >= 0 && i < chunks.length);
      const best = candidates.reduce((nearest, i) => (distance(span, chunks[i]!) < distance(span, chunks[nearest]!) ? i : nearest));
      runs[best]!.push(this.runs[index]!);
    });
    return runs;
  }

  private diff(a: string, b: string): readonly Change[] {
    const [docA, docB] = [Text.of(a.split("\n")), Text.of(b.split("\n"))];
    // Only whole documents are compared: a read-only diff is never edited.
    if (docA.length !== this.a.start(Infinity) || docB.length !== this.b.start(Infinity)) return diff(a, b);
    const tried = this.spans.map(() => 0);
    const encode = () =>
      this.spans.flatMap((span, index) => {
        for (let encoding = tried[index]!; encoding < ENCODINGS.length; encoding++) {
          const changes = ENCODINGS[encoding]!(span, a, b);
          if (changes) {
            tried[index] = encoding;
            return changes;
          }
        }
        return [];
      });
    let changes = encode();
    for (let round = 1; round < ENCODINGS.length; round++) {
      // Building chunks changes the list it is given.
      const chunks = Chunk.build(docA, docB, { override: () => [...changes] });
      const misplaced = this.misplaced(chunks, docA.length, docB.length);
      if (!misplaced.length) break;
      for (const index of misplaced) tried[index] = Math.min(tried[index]! + 1, ENCODINGS.length - 1);
      changes = encode();
    }
    return changes;
  }

  /** The runs that no chunk covers exactly: chunks may span several runs, but not more than their lines. */
  private misplaced(chunks: readonly Chunk[], lengthA: number, lengthB: number): number[] {
    const misplaced: number[] = [];
    let next = 0;
    for (const chunk of chunks) {
      const [toA, toB] = [Math.min(chunk.toA, lengthA), Math.min(chunk.toB, lengthB)];
      const before = (span: Span) => span.toA < chunk.fromA || span.toB < chunk.fromB;
      while (next < this.spans.length && before(this.spans[next]!) && !this.inside(this.spans[next]!, chunk, toA, toB))
        misplaced.push(next++);
      const first = next;
      while (next < this.spans.length && this.inside(this.spans[next]!, chunk, toA, toB)) next++;
      const group = this.spans.slice(first, next);
      if (!group.length) {
        if (next < this.spans.length) misplaced.push(next++);
        continue;
      }
      const exact =
        group[0]!.fromA === chunk.fromA && group[0]!.fromB === chunk.fromB && group.at(-1)!.toA === toA && group.at(-1)!.toB === toB;
      if (!exact) for (let index = first; index < next; index++) misplaced.push(index);
    }
    for (; next < this.spans.length; next++) misplaced.push(next);
    return misplaced;
  }

  private inside(span: Span, chunk: Chunk, toA: number, toB: number): boolean {
    return chunk.fromA <= span.fromA && span.toA <= toA && chunk.fromB <= span.fromB && span.toB <= toB;
  }
}
