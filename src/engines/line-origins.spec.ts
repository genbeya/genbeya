import { describe, expect, it } from "vitest";
import { lineAuthors } from "./line-origins";

describe("lineAuthors", () => {
  it("names who added each line, and nobody for lines no commit has", () => {
    const revisions = [
      { author: "Sam", before: "a\nb\n", after: "a\nb\nc\n" },
      { author: "Frank", before: "a\n", after: "a\nb\n" },
      { author: "Alex", before: null, after: "a\n" },
    ];
    expect(lineAuthors(revisions, ["a", "b", "c", "d"])).toEqual(["Alex", "Frank", "Sam", null]);
  });
});
