import { describe, expect, it } from "vitest";
import { PatchEngine } from "../../engines/patch-engine";
import { unifiedDiff } from "./unified-diff";

const numbered = (count: number, change: Record<number, string> = {}) =>
  Array.from({ length: count }, (_, i) => `${change[i + 1] ?? `line ${i + 1}`}\n`).join("");

describe("unifiedDiff", () => {
  it("prints a change with three lines of context, as git does", () => {
    expect(unifiedDiff("a.txt", "a.txt", numbered(10), numbered(10, { 5: "five" }))).toBe(
      [
        "diff --git a/a.txt b/a.txt",
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -2,7 +2,7 @@",
        " line 2",
        " line 3",
        " line 4",
        "-line 5",
        "+five",
        " line 6",
        " line 7",
        " line 8",
        "",
      ].join("\n"),
    );
  });

  it("joins hunks whose context would overlap, and keeps the others apart", () => {
    // Six unchanged lines between: the contexts of both meet.
    const joined = unifiedDiff("a", "a", numbered(20), numbered(20, { 3: "x", 10: "y" }));
    expect(joined.match(/^@@.*$/gm)).toEqual(["@@ -1,13 +1,13 @@"]);
    const apart = unifiedDiff("a", "a", numbered(20), numbered(20, { 3: "x", 11: "y" }));
    expect(apart.match(/^@@.*$/gm)).toEqual(["@@ -1,6 +1,6 @@", "@@ -8,7 +8,7 @@"]);
  });

  it("prints creations, deletions and missing final line breaks", () => {
    expect(unifiedDiff(null, "n.txt", "", "a\nb")).toBe(
      "diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n",
    );
    expect(unifiedDiff("d.txt", null, "a\n", "")).toBe(
      "diff --git a/d.txt b/d.txt\ndeleted file mode 100644\n--- a/d.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-a\n",
    );
    expect(unifiedDiff("a", "a", "x\n", "x\n")).toBe("");
  });

  it("reads back with the patch engine as a diff from one version to the other", () => {
    const engine = new PatchEngine();
    const cases: [string, string][] = [
      [numbered(30), numbered(32, { 4: "four", 20: "twenty" })],
      ["a\nb\nc", "a\nB\nc\n"],
      ["", "only\n"],
      ["one\ntwo\n", "two\n"],
    ];
    for (const [before, after] of cases) {
      const diff = engine.parse(unifiedDiff("f", "f", before, after));
      expect(engine.describes(diff, before, after)).toBe(true);
    }
  });
});
