import { describe, expect, it } from "vitest";
import { SEARCH_LIMITS, SearchEngine, type SearchQuery } from "./search-engine";

const engine = new SearchEngine();
const query = (text: string, change: Partial<SearchQuery> = {}): SearchQuery => ({
  text,
  caseSensitive: false,
  regex: false,
  wholeWord: false,
  ...change,
});

describe("SearchEngine.validate", () => {
  it("defaults to literal text, ignoring case", () => {
    expect(engine.validate("-e foo", undefined)).toEqual(query("-e foo"));
    expect(engine.validate("x", { regex: true, wholeWord: true, caseSensitive: true })).toEqual(
      query("x", { regex: true, wholeWord: true, caseSensitive: true }),
    );
  });

  it.each([
    ["no text", "", undefined, "Enter text to search for."],
    ["blank text", "   ", undefined, "Enter text to search for."],
    ["a number", 5, undefined, "Enter text to search for."],
    ["long text", "x".repeat(SEARCH_LIMITS.query + 1), undefined, `at most ${SEARCH_LIMITS.query} characters`],
    ["several lines", "a\nb", undefined, "one line"],
    ["a NUL", "a\0b", undefined, "one line"],
    ["options that are not an object", "a", "regex", "Invalid search options."],
    ["a flag that is not a boolean", "a", { regex: "yes" }, "Invalid search options."],
  ])("rejects %s", (_, text, options, message) => {
    expect(() => engine.validate(text, options)).toThrow(message);
  });
});

describe("SearchEngine.areaOf", () => {
  const settings = { wikiRoot: "docs", taskRoot: "tasks" };

  it("puts Markdown below the task and wiki folders in their areas, and everything else in code", () => {
    expect(engine.areaOf("tasks/Auth/TP-1.md", settings)).toBe("tasks");
    expect(engine.areaOf("docs/Guide/Setup.MD", settings)).toBe("wiki");
    expect(engine.areaOf("docs/diagram.svg", settings)).toBe("code");
    expect(engine.areaOf("README.md", settings)).toBe("code");
    expect(engine.areaOf("docs/tasks/TP-2.md", { wikiRoot: "docs", taskRoot: "docs/tasks" })).toBe("tasks");
  });
});

describe("SearchEngine.matcher", () => {
  it("finds every literal occurrence, ignoring case", () => {
    expect(engine.matcher(query("a.b"))("A.B axb a.b")).toEqual([
      { start: 0, end: 3 },
      { start: 8, end: 11 },
    ]);
  });

  it("respects case, whole words and regular expressions", () => {
    expect(engine.matcher(query("Log", { caseSensitive: true }))("log Log")).toEqual([{ start: 4, end: 7 }]);
    expect(engine.matcher(query("log", { wholeWord: true }))("login log_x log, LOG")).toEqual([
      { start: 12, end: 15 },
      { start: 17, end: 20 },
    ]);
    expect(engine.matcher(query("colou?r", { regex: true }))("color colour")).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 12 },
    ]);
  });

  it("finds nothing for patterns JavaScript cannot read, and skips empty matches", () => {
    expect(engine.matcher(query("(?P<x>a)", { regex: true }))("abc")).toEqual([]);
    expect(engine.matcher(query("x*", { regex: true }))("axxb")).toEqual([{ start: 1, end: 3 }]);
  });
});

describe("SearchEngine.excerpt", () => {
  it("keeps short lines whole", () => {
    expect(engine.excerpt("short line", [{ start: 6, end: 10 }])).toEqual({ text: "short line", ranges: [{ start: 6, end: 10 }] });
  });

  it("shortens long lines around the first match and moves the ranges along", () => {
    const line = "a".repeat(1000) + "needle" + "b".repeat(1000);
    const { text, ranges } = engine.excerpt(line, [{ start: 1000, end: 1006 }]);
    expect(text.length).toBe(SEARCH_LIMITS.lineLength + 2);
    expect(text.startsWith("…a")).toBe(true);
    expect(text.endsWith("b…")).toBe(true);
    expect(text.slice(ranges[0]!.start, ranges[0]!.end)).toBe("needle");
  });

  it("drops ranges outside the excerpt and clips those at its edge", () => {
    const line = "x".repeat(50) + "y".repeat(1000);
    const { text, ranges } = engine.excerpt(line, [
      { start: 0, end: 60 },
      { start: 900, end: 905 },
    ]);
    expect(text.startsWith("xxx")).toBe(true);
    expect(ranges).toEqual([{ start: 0, end: 60 }]);
  });

  it("shortens lines without a match from their start", () => {
    expect(engine.excerpt("z".repeat(1000), []).text).toBe("z".repeat(SEARCH_LIMITS.lineLength) + "…");
  });
});
