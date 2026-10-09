import { fuzzyScore } from "./fuzzy";

describe("fuzzyScore", () => {
  it("prefers substring and word-start matches", () => {
    expect(fuzzyScore("Getting started", "start")).toBeGreaterThan(fuzzyScore("Restart service", "start"));
    expect(fuzzyScore("Home", "ho")).toBeGreaterThan(fuzzyScore("Echo", "ho"));
  });

  it("matches scattered letters below substrings, and rejects non-matches", () => {
    expect(fuzzyScore("workspace.ts", "wsts")).toBeGreaterThan(0);
    expect(fuzzyScore("workspace.ts", "wsts")).toBeLessThan(fuzzyScore("workspace.ts", "space"));
    expect(fuzzyScore("workspace.ts", "xyz")).toBe(-1);
  });
});
