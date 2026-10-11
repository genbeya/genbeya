import { Chunk } from "@codemirror/merge";
import { Text } from "@codemirror/state";
import type { DiffChange, LineRange } from "../../../contracts/model";
import { GitChanges, GitLines } from "./git-changes";
import { chunkLines, type ChunkLines } from "./line-selection";

const range = (from: number, to = from) => ({ from, to });

/** The chunks a merge view shows with git's changes, and git's runs in each. */
function shown(changes: readonly DiffChange[], original: string, modified: string) {
  const git = new GitChanges(changes, original, modified);
  const [a, b] = [Text.of(original.split(/\r\n?|\n/)), Text.of(modified.split(/\r\n?|\n/))];
  const chunks = Chunk.build(a, b, git.config);
  const runs = git.runsIn(chunks);
  return { git, chunks: chunks.map((chunk, index) => ({ lines: chunkLines(chunk, a, b), runs: runs[index]! })) };
}

/** The lines from the first of `changes` to the last in each version, as one chunk covering them shows. */
function covered(changes: readonly DiffChange[]): Pick<ChunkLines, "original" | "modified"> {
  const [first, last] = [changes[0]!, changes.at(-1)!];
  const lines = (from: number, to: number): LineRange | null => (from <= to ? range(from, to) : null);
  return {
    original: lines(first.oldStart, last.oldStart + last.oldCount - 1),
    modified: lines(first.newStart, last.newStart + last.newCount - 1),
  };
}

/** Some shortest line diff, picking among equally short ones by `random`: git's choices can be any of them. */
function lineDiff(a: readonly string[], b: readonly string[], random: () => number): DiffChange[] {
  const lcs = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const changes: DiffChange[] = [];
  let run: { oldStart: number; oldCount: number; newStart: number; newCount: number } | null = null;
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length) {
    const keep = i < a.length && j < b.length && a[i] === b[j] && lcs[i]![j] === lcs[i + 1]![j + 1]! + 1;
    const remove = i < a.length && lcs[i]![j] === lcs[i + 1]![j];
    const add = j < b.length && lcs[i]![j] === lcs[i]![j + 1];
    const moves = [keep && "keep", remove && "remove", add && "add"].filter(Boolean);
    const move = moves[Math.floor(random() * moves.length)];
    if (move === "keep") {
      if (run) changes.push(run);
      run = null;
      i++;
      j++;
      continue;
    }
    run ??= { oldStart: i + 1, oldCount: 0, newStart: j + 1, newCount: 0 };
    if (move === "remove") {
      run.oldCount++;
      i++;
    } else {
      run.newCount++;
      j++;
    }
  }
  if (run) changes.push(run);
  return changes;
}

describe("git's changes in a merge view", () => {
  it("numbers git's lines in the editor, which breaks lines at lone carriage returns too", () => {
    const lines = new GitLines("a\r\nb\rc\nd");
    expect([1, 2, 3, 4].map((line) => lines.start(line))).toEqual([0, 2, 6, 7]);
    expect([0, 1, 2, 4, 6, 7].map((position) => lines.lineAt(position))).toEqual([1, 1, 2, 2, 3, 3]);
    expect(lines.lines(Text.of(["a", "b", "c", "d"]), [range(2, 3)])).toEqual([range(2, 2)]);
    expect(new GitLines("").start(1)).toBe(0);
  });

  // The reviewer's cases, with git's diff of them: CodeMirror's own diff places some changes a line away.
  it.each<[string, string[], string[], DiffChange[]]>([
    [
      "repeated calls",
      ["  y();", "if (a) {", "  y();", "{", "return;"],
      ["", "if (a) {", "if (a) {", "{", "return;"],
      [
        { oldStart: 1, oldCount: 1, newStart: 1, newCount: 2 },
        { oldStart: 3, oldCount: 1, newStart: 4, newCount: 0 },
      ],
    ],
    [
      "nested braces",
      ["}", "return;", "  x();", "", "{", "}", "  x();", "", "  y();", "return;", ""],
      ["}", "return;", "  x();", "", "{", "{", "}", "  x();", "", "  y();", "return;", ""],
      [{ oldStart: 5, oldCount: 0, newStart: 5, newCount: 1 }],
    ],
    [
      "braces and blanks",
      ["  x();", "{", "}", "{", "", "if (a) {", "  y();", "", "return;", "if (a) {"],
      ["  x();", "{", "  y();", "{", "}", "{", "{", "", "if (a) {", "  y();", "return;", "if (a) {"],
      [
        { oldStart: 2, oldCount: 0, newStart: 2, newCount: 2 },
        { oldStart: 5, oldCount: 0, newStart: 7, newCount: 1 },
        { oldStart: 8, oldCount: 1, newStart: 11, newCount: 0 },
      ],
    ],
  ])("shows the changes of %s where git has them", (_name, before, after, changes) => {
    const [original, modified] = [before, after].map((rows) => rows.map((row) => `${row}\n`).join("")) as [string, string];
    const { chunks, git } = shown(changes, original, modified);
    const lines = chunks.map(({ lines: { original, modified } }) => ({ original, modified }));
    expect(chunks.flatMap(({ runs }) => runs)).toEqual(git.runs);
    expect(lines).toEqual(chunks.map(({ runs }) => covered(runs.map((run) => changes[git.runs.indexOf(run)]!))));
    const [a, b] = [Text.of(original.split("\n")), Text.of(modified.split("\n"))];
    const own = Chunk.build(a, b).map((chunk) => chunkLines(chunk, a, b));
    expect(own.map(({ original, modified }) => ({ original, modified }))).not.toEqual(lines);
  });

  it("covers exactly git's lines, wherever git places a change", () => {
    let seed = 12345;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const alphabet = ["{", "}", "", "x", "x y", "  a();"];
    for (let round = 0; round < 2000; round++) {
      const end = random() < 0.2 ? "\r\n" : "\n";
      // Lines with their line breaks, as git compares them: a last line without one differs.
      const version = () => {
        const rows = Array.from({ length: Math.floor(random() * 9) }, () => alphabet[Math.floor(random() * alphabet.length)]!);
        const ended = random() < 0.8;
        return rows.map((row, i) => (i < rows.length - 1 || ended ? `${row}${end}` : row)).filter((row) => row !== "");
      };
      const [a, b] = [version(), version()];
      const changes = lineDiff(a, b, random);
      const [original, modified] = [a.join(""), b.join("")];
      const { chunks, git } = shown(changes, original, modified);
      const context = JSON.stringify({ original, modified, changes });
      // Every run is in exactly one chunk, and each chunk shows its runs' lines.
      expect(
        chunks.flatMap(({ runs }) => runs),
        context,
      ).toEqual(git.runs);
      // CodeMirror starts no chunk with an empty line added before an empty first line; the run goes with the chunk after it.
      const empty = (row: string | undefined) => row === end || row === "";
      if (changes[0]?.oldStart === 1 && changes[0].newStart === 1 && empty(a[0]) && empty(b[0])) continue;
      // A chunk at the end may include the empty line the editor shows after a final line break.
      const within = (lines: LineRange | null, count: number) =>
        lines && lines.from <= count ? range(lines.from, Math.min(lines.to, count)) : null;
      for (const { lines, runs } of chunks) {
        const inChunk = runs.map((run) => changes[git.runs.indexOf(run)]!);
        const shownLines = { original: within(lines.original, a.length), modified: within(lines.modified, b.length) };
        expect(shownLines, context).toEqual(covered(inChunk));
      }
    }
  });
});
