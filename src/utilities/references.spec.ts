import { describe, expect, it } from "vitest";
import { findReference, normalizeTitle, parseLines, referenceIndex, WIKILINK } from "./references";

const index = referenceIndex({
  wikiRoot: "docs",
  pages: [
    { title: "Home", path: "docs/Home.md" },
    { title: "Wiki", path: "docs/Guide/Wiki.md" },
  ],
  tasks: [{ id: "GENBEYA-12" }],
  files: ["src/app.ts", "docs/Home.md"],
});
const home = { title: "Home", path: "docs/Home.md" };
const wiki = { title: "Wiki", path: "docs/Guide/Wiki.md" };

describe("findReference", () => {
  it.each([
    ["GENBEYA-12", { kind: "task", task: { id: "GENBEYA-12" } }],
    ["genbeya-12", { kind: "task", task: { id: "GENBEYA-12" } }],
    ["home", { kind: "page", page: home, style: "title" }],
    ["Home#Start", { kind: "page", page: home, style: "title", anchor: "Start" }],
    ["Guide/Wiki", { kind: "page", page: wiki, style: { root: "wiki", extension: false } }],
    ["Guide/Wiki.md", { kind: "page", page: wiki, style: { root: "wiki", extension: true } }],
    ["docs/Guide/Wiki", { kind: "page", page: wiki, style: { root: "repository", extension: false } }],
    ["/docs/guide/wiki.md", { kind: "page", page: wiki, style: { root: "repository", extension: true } }],
    ["src/app.ts#L3-L1", { kind: "file", path: "src/app.ts", lines: { from: 1, to: 3 }, exists: true }],
    ["src/gone.ts", { kind: "file", path: "src/gone.ts", lines: null, exists: false }],
    ["Glossary", { kind: "missing" }],
    ["../outside.txt", { kind: "missing" }],
  ])("resolves %s", (target, expected) => {
    expect(findReference(target, index)).toEqual(expected);
  });
});

describe("reference helpers", () => {
  it("matches titles regardless of case, dashes and underscores", () => {
    expect(normalizeTitle(" Getting_started-Guide ")).toBe("getting started guide");
  });

  it("parses line fragments", () => {
    expect(parseLines("L10")).toEqual({ from: 10, to: 10 });
    expect(parseLines("L20-10")).toEqual({ from: 10, to: 20 });
    expect(parseLines("intro")).toBeNull();
    expect(parseLines(undefined)).toBeNull();
  });

  it("finds references with their targets and labels", () => {
    expect([..."See [[Home]] and [[Guide/Wiki#Links|the wiki]].".matchAll(WIKILINK)].map((m) => [m[1], m[2]])).toEqual([
      ["Home", undefined],
      ["Guide/Wiki#Links", "the wiki"],
    ]);
  });

  it("reads brackets inside references as before, and a nested [[ as the start of the next one", () => {
    const found = (text: string) => [...text.matchAll(WIKILINK)].map((m) => [m[1], m[2]]);
    expect(found("[[a[b]] [[[x]] [[c|d [e]]")).toEqual([
      ["a[b", undefined],
      ["[x", undefined],
      ["c", "d [e"],
    ]);
    expect(found("[[a|b] [[c]]")).toEqual([["c", undefined]]);
    expect(found("[[a [[b]] [[c|x [[d]]")).toEqual([
      ["b", undefined],
      ["d", undefined],
    ]);
    expect(found("[[a\nb]] [[]] [[|x]]")).toEqual([]);
  });

  it("finds references in linear time on long lines", () => {
    for (const line of ["[[".repeat(40_000), "[[a|".repeat(20_000), `[[${"a[".repeat(40_000)}`, `[[a|${"b[".repeat(40_000)}`]) {
      const started = performance.now();
      expect([...line.matchAll(WIKILINK)]).toEqual([]);
      expect(performance.now() - started).toBeLessThan(200);
    }
  });
});
