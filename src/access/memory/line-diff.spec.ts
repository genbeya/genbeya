import { describe, expect, it } from "vitest";
import { diffLines, splitLines, type LineChange } from "./line-diff";

/** Applies `changes` to `a`, taking the new lines from `b`. */
function apply(a: readonly string[], b: readonly string[], changes: readonly LineChange[]): string[] {
  const result: string[] = [];
  let at = 0;
  for (const change of changes) {
    result.push(...a.slice(at, change.aStart), ...b.slice(change.bStart, change.bEnd));
    at = change.aEnd;
  }
  return [...result, ...a.slice(at)];
}

const lines = (text: string) => text.split("");

describe("splitLines", () => {
  it("keeps line breaks and a last line without one", () => {
    expect(splitLines("a\nb\n")).toEqual(["a\n", "b\n"]);
    expect(splitLines("a\nb")).toEqual(["a\n", "b"]);
    expect(splitLines("")).toEqual([]);
    expect(splitLines("\n\n")).toEqual(["\n", "\n"]);
  });
});

describe("diffLines", () => {
  it("finds nothing in equal versions", () => {
    expect(diffLines(lines("abc"), lines("abc"))).toEqual([]);
  });

  it("finds additions, removals and replacements as runs", () => {
    expect(diffLines(lines("ac"), lines("abc"))).toEqual([{ aStart: 1, aEnd: 1, bStart: 1, bEnd: 2 }]);
    expect(diffLines(lines("abc"), lines("ac"))).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 1 }]);
    expect(diffLines(lines("abc"), lines("axc"))).toEqual([{ aStart: 1, aEnd: 2, bStart: 1, bEnd: 2 }]);
    expect(diffLines([], lines("ab"))).toEqual([{ aStart: 0, aEnd: 0, bStart: 0, bEnd: 2 }]);
    expect(diffLines(lines("ab"), [])).toEqual([{ aStart: 0, aEnd: 2, bStart: 0, bEnd: 0 }]);
  });

  it("finds a shortest edit script", () => {
    // Myers' example: 5 edits.
    const changes = diffLines(lines("ABCABBA"), lines("CBABAC"));
    const edits = changes.reduce((sum, change) => sum + change.aEnd - change.aStart + change.bEnd - change.bStart, 0);
    expect(edits).toBe(5);
    expect(apply(lines("ABCABBA"), lines("CBABAC"), changes).join("")).toBe("CBABAC");
  });

  it("turns any version into any other", () => {
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let round = 0; round < 200; round++) {
      const make = () => Array.from({ length: Math.floor(random() * 12) }, () => "abcd"[Math.floor(random() * 4)]!);
      const a = make();
      const b = make();
      expect(apply(a, b, diffLines(a, b))).toEqual(b);
    }
  });
});
