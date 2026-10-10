import { describe, expect, it } from "vitest";
import { hasConflictMarkers, parseConflicts, resolveHunk } from "./conflict-markers";

const merge = ["before\n", "<<<<<<< HEAD\n", "ours 1\n", "ours 2\n", "=======\n", "theirs\n", ">>>>>>> feature\n", "after\n"].join("");

describe("parseConflicts", () => {
  it("reads both sides, their labels and where the hunk is", () => {
    const [hunk, ...rest] = parseConflicts(merge);
    expect(rest).toEqual([]);
    expect(hunk).toEqual({
      from: "before\n".length,
      to: merge.length - "after\n".length,
      line: 2,
      lines: 6,
      ours: "ours 1\nours 2\n",
      base: null,
      theirs: "theirs\n",
      oursLabel: "HEAD",
      theirsLabel: "feature",
    });
  });

  it("reads the common ancestor of the diff3 style", () => {
    const text = "<<<<<<< HEAD\nours\n||||||| base\nbase\n=======\ntheirs\n>>>>>>> 1234567 (Subject)\n";
    expect(parseConflicts(text)[0]).toMatchObject({ ours: "ours\n", base: "base\n", theirs: "theirs\n", theirsLabel: "1234567 (Subject)" });
  });

  it("finds several hunks, empty sides, Windows line endings and a missing final line break", () => {
    const text = "<<<<<<< HEAD\r\n=======\r\nadded\r\n>>>>>>> b\r\nmiddle\n<<<<<<< HEAD\nx\n=======\ny\n>>>>>>> b";
    const hunks = parseConflicts(text);
    expect(hunks.map(({ ours, theirs, line }) => ({ ours, theirs, line }))).toEqual([
      { ours: "", theirs: "added\r\n", line: 1 },
      { ours: "x\n", theirs: "y\n", line: 6 },
    ]);
    expect(hunks[1]!.to).toBe(text.length);
  });

  it("honours longer markers and ignores look-alikes and unfinished hunks", () => {
    expect(parseConflicts("<<<<<<<<<< HEAD\na\n=======\nnot a separator\n==========\nb\n>>>>>>>>>> x\n")[0]).toMatchObject({
      ours: "a\n=======\nnot a separator\n",
      theirs: "b\n",
    });
    expect(parseConflicts("<<<<<<<HEAD\n=======\n>>>>>>> x\n")).toEqual([]);
    expect(parseConflicts("<<<<<<< HEAD\na\n=======\nb\n")).toEqual([]);
    expect(hasConflictMarkers("plain\ntext\n")).toBe(false);
    expect(hasConflictMarkers(merge)).toBe(true);
  });
});

describe("resolveHunk", () => {
  const hunk = parseConflicts(merge)[0]!;

  it("keeps one side or both, current first", () => {
    expect(resolveHunk(merge, hunk, "ours")).toBe("before\nours 1\nours 2\nafter\n");
    expect(resolveHunk(merge, hunk, "theirs")).toBe("before\ntheirs\nafter\n");
    expect(resolveHunk(merge, hunk, "both")).toBe("before\nours 1\nours 2\ntheirs\nafter\n");
  });

  it("resolves the diff3 style without its ancestor, leaving other hunks alone", () => {
    const text = "<<<<<<< HEAD\na\n||||||| base\no\n=======\nb\n>>>>>>> x\nmid\n" + merge;
    const [first] = parseConflicts(text);
    const resolved = resolveHunk(text, first!, "both");
    expect(resolved).toBe("a\nb\nmid\n" + merge);
    expect(parseConflicts(resolved)).toHaveLength(1);
  });
});
