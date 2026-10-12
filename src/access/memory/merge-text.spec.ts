import { describe, expect, it } from "vitest";
import { parseConflicts } from "../../utilities/conflict-markers";
import { mergeText } from "./merge-text";

const labels = { ours: "HEAD", theirs: "feature" };
const text = (...lines: string[]) => lines.map((line) => `${line}\n`).join("");

describe("mergeText", () => {
  it("takes the side that changed", () => {
    expect(mergeText("a\n", "a\n", "b\n", labels)).toEqual({ text: "b\n", conflicts: 0 });
    expect(mergeText("a\n", "b\n", "a\n", labels)).toEqual({ text: "b\n", conflicts: 0 });
    expect(mergeText("a\n", "b\n", "b\n", labels)).toEqual({ text: "b\n", conflicts: 0 });
  });

  it("combines changes to lines apart from each other", () => {
    const base = text("1", "2", "3", "4", "5");
    expect(mergeText(base, text("one", "2", "3", "4", "5"), text("1", "2", "3", "4", "five"), labels)).toEqual({
      text: text("one", "2", "3", "4", "five"),
      conflicts: 0,
    });
    // Both sides adding the same line is one addition.
    expect(mergeText(base, text("1", "2", "x", "3", "4", "5"), text("1", "2", "x", "3", "4", "5"), labels).conflicts).toBe(0);
  });

  it("marks changes to the same lines, shrunk to what differs", () => {
    const merged = mergeText(text("a", "b", "c"), text("a", "B", "x", "c"), text("a", "b2", "x", "c"), labels);
    expect(merged.conflicts).toBe(1);
    expect(merged.text).toBe(text("a", "<<<<<<< HEAD", "B", "=======", "b2", ">>>>>>> feature", "x", "c"));
    const [hunk] = parseConflicts(merged.text);
    expect(hunk).toMatchObject({ ours: "B\n", theirs: "b2\n", oursLabel: "HEAD", theirsLabel: "feature" });
  });

  it("marks changes to neighbouring lines, as Git does", () => {
    expect(mergeText(text("1", "2"), text("one", "2"), text("1", "two"), labels).conflicts).toBe(1);
  });

  it("marks files both sides created differently", () => {
    const merged = mergeText("", text("mine"), text("theirs"), labels);
    expect(merged.text).toBe(text("<<<<<<< HEAD", "mine", "=======", "theirs", ">>>>>>> feature"));
  });

  it("starts markers on a line of their own after a last line without a line break", () => {
    const merged = mergeText("a", "b", "c", labels);
    expect(merged.text).toBe(text("<<<<<<< HEAD", "b", "=======", "c", ">>>>>>> feature"));
  });
});
