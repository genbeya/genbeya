import { describe, expect, it } from "vitest";
import type { LineSelection } from "../contracts/model";
import { PatchEngine, type PatchDirection } from "./patch-engine";

const engine = new PatchEngine();
const NO_NEWLINE = "\\ No newline at end of file";
const lines = (...rows: string[]) => rows.map((row) => `${row}\n`).join("");
const select = (original: [number, number][], modified: [number, number][] = []): LineSelection => ({
  original: original.map(([from, to]) => ({ from, to })),
  modified: modified.map(([from, to]) => ({ from, to })),
});
const header = (path = "f.txt") => [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];

/** a…l, with b replaced by B and B2, and k by K. */
const TWO_HUNKS = lines(
  "diff --git a/f.txt b/f.txt",
  "index 1111111..2222222 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,5 +1,6 @@",
  " a",
  "-b",
  "+B",
  "+B2",
  " c",
  " d",
  " e",
  "@@ -8,5 +9,5 @@",
  " h",
  " i",
  " j",
  "-k",
  "+K",
  " l",
);

const REPLACED = lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", "-a", "-b", "+A", "+B");

const CREATED = lines(
  "diff --git a/n.txt b/n.txt",
  "new file mode 100755",
  "index 0000000..3333333",
  "--- /dev/null",
  "+++ b/n.txt",
  "@@ -0,0 +1,3 @@",
  "+one",
  "+two",
  "+three",
);

const DELETED = lines(
  "diff --git a/d.txt b/d.txt",
  "deleted file mode 100644",
  "index 3333333..0000000",
  "--- a/d.txt",
  "+++ /dev/null",
  "@@ -1,3 +0,0 @@",
  "-one",
  "-two",
  "-three",
);

const cases: [name: string, diff: string, direction: PatchDirection, selection: LineSelection, patch: string[]][] = [
  [
    "a whole second hunk, its start moved back by nothing staged before it",
    TWO_HUNKS,
    "forward",
    select([[11, 11]], [[12, 12]]),
    [...header(), "@@ -8,5 +8,5 @@", " h", " i", " j", "-k", "+K", " l"],
  ],
  [
    "a whole first hunk",
    TWO_HUNKS,
    "forward",
    select([[2, 2]], [[2, 3]]),
    [...header(), "@@ -1,5 +1,6 @@", " a", "-b", "+B", "+B2", " c", " d", " e"],
  ],
  [
    "both hunks: the second one starts after what the first adds",
    TWO_HUNKS,
    "forward",
    select([[1, 20]], [[1, 20]]),
    [...header(), "@@ -1,5 +1,6 @@", " a", "-b", "+B", "+B2", " c", " d", " e", "@@ -8,5 +9,5 @@", " h", " i", " j", "-k", "+K", " l"],
  ],
  [
    "part of the first hunk and the second, which starts after what that part adds",
    TWO_HUNKS,
    "forward",
    select(
      [[11, 11]],
      [
        [3, 3],
        [12, 12],
      ],
    ),
    [...header(), "@@ -1,5 +1,6 @@", " a", " b", "+B2", " c", " d", " e", "@@ -8,5 +9,5 @@", " h", " i", " j", "-k", "+K", " l"],
  ],
  [
    "the first changed line at the edge of a hunk: other removals become context, other additions go",
    TWO_HUNKS,
    "forward",
    select([[2, 2]]),
    [...header(), "@@ -1,5 +1,4 @@", " a", "-b", " c", " d", " e"],
  ],
  [
    "the last added line at the edge of a hunk",
    TWO_HUNKS,
    "forward",
    select([], [[3, 3]]),
    [...header(), "@@ -1,5 +1,6 @@", " a", " b", "+B2", " c", " d", " e"],
  ],
  [
    "reversed (unstaging): other additions become context, other removals go",
    TWO_HUNKS,
    "reverse",
    select([], [[3, 3]]),
    [...header(), "@@ -1,5 +1,6 @@", " a", " B", "+B2", " c", " d", " e"],
  ],
  [
    "reversed: a second hunk keeps its place in the modified version",
    TWO_HUNKS,
    "reverse",
    select([[11, 11]], [[12, 12]]),
    [...header(), "@@ -9,5 +9,5 @@", " h", " i", " j", "-k", "+K", " l"],
  ],
  [
    "reversed: a later hunk's original start follows what earlier ones leave out",
    TWO_HUNKS,
    "reverse",
    select(
      [],
      [
        [3, 3],
        [12, 12],
      ],
    ),
    [...header(), "@@ -1,5 +1,6 @@", " a", " B", "+B2", " c", " d", " e", "@@ -8,4 +9,5 @@", " h", " i", " j", "+K", " l"],
  ],
  [
    "the first of two replaced lines, which keeps its place",
    REPLACED,
    "forward",
    select([[1, 1]], [[1, 1]]),
    [...header(), "@@ -1,2 +1,2 @@", "-a", "+A", " b"],
  ],
  ["the second of two replaced lines", REPLACED, "forward", select([[2, 2]], [[2, 2]]), [...header(), "@@ -1,2 +1,2 @@", " a", "-b", "+B"]],
  [
    "a removal and an addition that do not belong together",
    REPLACED,
    "forward",
    select([[1, 1]], [[2, 2]]),
    [...header(), "@@ -1,2 +1,2 @@", "-a", " b", "+B"],
  ],
  ["an addition next to a kept removal", REPLACED, "forward", select([], [[1, 1]]), [...header(), "@@ -1,2 +1,3 @@", " a", "+A", " b"]],
  [
    "reversed: the first of two replaced lines",
    REPLACED,
    "reverse",
    select([[1, 1]], [[1, 1]]),
    [...header(), "@@ -1,2 +1,2 @@", "-a", "+A", " B"],
  ],
  [
    "a line added after a last line without newline: the old last line gains one",
    lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,3 @@", " a", "-b", NO_NEWLINE, "+b", "+c"),
    "forward",
    select([], [[3, 3]]),
    [...header(), "@@ -1,2 +1,3 @@", " a", "-b", NO_NEWLINE, "+b", "+c"],
  ],
  [
    "only the newline added at the end",
    lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,3 @@", " a", "-b", NO_NEWLINE, "+b", "+c"),
    "forward",
    select([[2, 2]], [[2, 2]]),
    [...header(), "@@ -1,2 +1,2 @@", " a", "-b", NO_NEWLINE, "+b"],
  ],
  [
    "a last line without newline that stays last",
    lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,3 @@", " a", " b", "+c", NO_NEWLINE),
    "forward",
    select([], [[3, 3]]),
    [...header(), "@@ -1,2 +1,3 @@", " a", " b", "+c", NO_NEWLINE],
  ],
  [
    "both versions without newline, keeping the old last line",
    lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", " a", "-b", NO_NEWLINE, "+c", NO_NEWLINE),
    "forward",
    select([], [[2, 2]]),
    [...header(), "@@ -1,2 +1,3 @@", " a", "-b", NO_NEWLINE, "+b", "+c", NO_NEWLINE],
  ],
  [
    "both versions without newline, removing the old last line only",
    lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", " a", "-b", NO_NEWLINE, "+c", NO_NEWLINE),
    "forward",
    select([[2, 2]]),
    [...header(), "@@ -1,2 +1,1 @@", " a", "-b", NO_NEWLINE],
  ],
  [
    "reversed: an added last line without newline",
    lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,2 +1,2 @@", " a", "-b", NO_NEWLINE, "+c", NO_NEWLINE),
    "reverse",
    select([], [[2, 2]]),
    [...header(), "@@ -1,1 +1,2 @@", " a", "+c", NO_NEWLINE],
  ],
  [
    "Windows line endings stay as they are",
    lines("diff --git a/f.txt b/f.txt", "--- a/f.txt", "+++ b/f.txt", "@@ -1,3 +1,3 @@", " a\r", "-b\r", "+B\r", "+X\r", " c\r").replace(
      "@@ -1,3 +1,3 @@",
      "@@ -1,3 +1,4 @@",
    ),
    "forward",
    select([[2, 2]], [[2, 2]]),
    [...header(), "@@ -1,3 +1,3 @@", " a\r", "-b\r", "+B\r", " c\r"],
  ],
  [
    "part of a new file stays a new file",
    CREATED,
    "forward",
    select([], [[2, 2]]),
    ["diff --git a/n.txt b/n.txt", "new file mode 100755", "--- /dev/null", "+++ b/n.txt", "@@ -0,0 +1,1 @@", "+two"],
  ],
  [
    "reversed, part of a new file leaves the rest in place",
    CREATED,
    "reverse",
    select([], [[2, 2]]),
    [...header("n.txt"), "@@ -1,2 +1,3 @@", " one", "+two", " three"],
  ],
  [
    "reversed, all of a new file removes it",
    CREATED,
    "reverse",
    select([], [[1, 3]]),
    ["diff --git a/n.txt b/n.txt", "new file mode 100755", "--- /dev/null", "+++ b/n.txt", "@@ -0,0 +1,3 @@", "+one", "+two", "+three"],
  ],
  [
    "part of a deletion keeps the file",
    DELETED,
    "forward",
    select([[1, 1]]),
    [...header("d.txt"), "@@ -1,3 +1,2 @@", "-one", " two", " three"],
  ],
  [
    "all of a deletion deletes the file",
    DELETED,
    "forward",
    select([[1, 3]]),
    ["diff --git a/d.txt b/d.txt", "deleted file mode 100644", "--- a/d.txt", "+++ /dev/null", "@@ -1,3 +0,0 @@", "-one", "-two", "-three"],
  ],
  [
    "reversed, part of a deletion brings back those lines",
    DELETED,
    "reverse",
    select([[2, 2]]),
    ["diff --git a/d.txt b/d.txt", "deleted file mode 100644", "--- a/d.txt", "+++ /dev/null", "@@ -1,1 +0,0 @@", "-two"],
  ],
  [
    "reversed, a renamed file keeps its new name",
    lines(
      "diff --git a/old.txt b/new.txt",
      "similarity index 80%",
      "rename from old.txt",
      "rename to new.txt",
      "index 1111111..2222222 100644",
      "--- a/old.txt",
      "+++ b/new.txt",
      "@@ -1,3 +1,3 @@",
      " a",
      "-b",
      "+B",
      " c",
    ),
    "reverse",
    select([[2, 2]], [[2, 2]]),
    [...header("new.txt"), "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"],
  ],
  [
    "quoted names and names with spaces",
    lines(
      'diff --git "a/q\\"x.txt" "b/q\\"x.txt"',
      "new file mode 100644",
      "--- /dev/null",
      '+++ "b/q\\"x.txt"',
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
    ),
    "reverse",
    select([], [[1, 1]]),
    ['diff --git "a/q\\"x.txt" "b/q\\"x.txt"', '--- "a/q\\"x.txt"', '+++ "b/q\\"x.txt"', "@@ -1,1 +1,2 @@", "+one", " two"],
  ],
  [
    "names with spaces, which git ends with a tab",
    lines("diff --git a/my file b/my file", "--- a/my file\t", "+++ b/my file\t", "@@ -1 +1 @@", "-a", "+b"),
    "forward",
    select([[1, 1]], [[1, 1]]),
    ["diff --git a/my file b/my file", "--- a/my file\t", "+++ b/my file\t", "@@ -1,1 +1,1 @@", "-a", "+b"],
  ],
];

describe("PatchEngine", () => {
  it.each(cases)("builds a patch of %s", (_name, diff, direction, selection, patch) => {
    expect(engine.patch(engine.parse(diff), selection, direction)).toBe(lines(...patch));
  });

  it("numbers the lines of both versions", () => {
    const [first, second] = engine.parse(TWO_HUNKS).hunks;
    expect(first!.lines.map((line) => [line.kind, line.oldLine, line.newLine])).toEqual([
      [" ", 1, 1],
      ["-", 2, null],
      ["+", null, 2],
      ["+", null, 3],
      [" ", 3, 4],
      [" ", 4, 5],
      [" ", 5, 6],
    ]);
    expect(second!.lines[3]).toMatchObject({ kind: "-", text: "k", oldLine: 11 });
  });

  it("refuses selections without changed lines", () => {
    expect(() => engine.patch(engine.parse(TWO_HUNKS), select([[1, 1]], [[1, 1]]), "forward")).toThrow("Select changed lines first.");
  });

  it("refuses binary files and diffs of several files", () => {
    const binary = engine.parse(lines("diff --git a/b.png b/b.png", "index 1..2 100644", "Binary files a/b.png and b/b.png differ"));
    expect(binary.binary).toBe(true);
    expect(() => engine.patch(binary, select([[1, 1]]), "forward")).toThrow("whole");
    expect(() => engine.parse(TWO_HUNKS + TWO_HUNKS)).toThrow("whole");
  });

  it("finds nothing to stage in an empty diff", () => {
    expect(engine.parse("").hunks).toEqual([]);
  });

  it("lists the runs of changed lines, a side without lines starting at the line the run comes before", () => {
    expect(engine.changes(engine.parse(TWO_HUNKS))).toEqual([
      { oldStart: 2, oldCount: 1, newStart: 2, newCount: 2 },
      { oldStart: 11, oldCount: 1, newStart: 12, newCount: 1 },
    ]);
    expect(engine.changes(engine.parse(CREATED))).toEqual([{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 3 }]);
    expect(engine.changes(engine.parse(DELETED))).toEqual([{ oldStart: 1, oldCount: 3, newStart: 1, newCount: 0 }]);
    const inserted = lines(...header(), "@@ -1,2 +1,3 @@", " a", "+x", " b");
    expect(engine.changes(engine.parse(inserted))).toEqual([{ oldStart: 2, oldCount: 0, newStart: 2, newCount: 1 }]);
    expect(engine.creation("one\ntwo")).toEqual([{ oldStart: 1, oldCount: 0, newStart: 1, newCount: 2 }]);
    expect(engine.creation("")).toEqual([]);
  });

  it("tells whether a diff describes two versions, whatever their line endings", () => {
    const original = lines(..."abcdefghijkl");
    const modified = lines("a", "B", "B2", ..."cdefghij", "K", "l");
    const diff = engine.parse(TWO_HUNKS);
    expect(engine.describes(diff, original, modified)).toBe(true);
    expect(engine.describes(diff, original, modified.replace(/\n/g, "\r\n"))).toBe(true);
    // Changed outside the hunks, or without the last line break.
    expect(engine.describes(diff, original, modified.replace("f", "F"))).toBe(false);
    expect(engine.describes(diff, original, modified.slice(0, -1))).toBe(false);
    expect(engine.describes(diff, original, original)).toBe(false);
    expect(engine.describes(engine.parse(""), "x\n", "x\n")).toBe(true);
    expect(engine.describes(engine.parse(CREATED), "", "one\ntwo\nthree\n")).toBe(true);
    const binary = engine.parse(lines("diff --git a/b.png b/b.png", "Binary files a/b.png and b/b.png differ"));
    expect(engine.describes(binary, "x", "y")).toBe(false);
  });

  it("builds patches of large hunks in linear time", () => {
    const count = 40_000;
    const removed = Array.from({ length: count }, (_, i) => `-${i}`);
    const added = Array.from({ length: count }, (_, i) => `+${i}x`);
    const diff = engine.parse(lines(...header(), `@@ -1,${count} +1,${count} @@`, ...removed, ...added));
    // Every other line: as many ranges as lines chosen.
    const every = Array.from({ length: count / 2 }, (_, i): [number, number] => [2 * i + 1, 2 * i + 1]);
    const started = performance.now();
    const patch = engine.patch(diff, select(every, every), "forward");
    expect(performance.now() - started).toBeLessThan(1000);
    expect(patch.split("\n").filter((row) => row.startsWith("+") && !row.startsWith("+++")).length).toBe(count / 2);
  });
});
