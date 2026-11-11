import { describe, expect, it } from "vitest";
import {
  fileFragment,
  findReference,
  isRevision,
  normalizeTitle,
  parseFileFragment,
  parseLines,
  referenceIndex,
  shortRevision,
  WIKILINK,
} from "./references";

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
    ["src/app.ts#L3-L1", { kind: "file", path: "src/app.ts", lines: { from: 1, to: 3 }, revision: null, exists: true }],
    ["src/gone.ts", { kind: "file", path: "src/gone.ts", lines: null, revision: null, exists: false }],
    ["src/app.ts#L4-L6@v0.1.0", { kind: "file", path: "src/app.ts", lines: { from: 4, to: 6 }, revision: "v0.1.0", exists: true }],
    ["Home#L3@v1", { kind: "file", path: "docs/Home.md", lines: { from: 3, to: 3 }, revision: "v1", exists: true }],
    ["Guide/Wiki#@v1", { kind: "file", path: "docs/Guide/Wiki.md", lines: null, revision: "v1", exists: false }],
    ["src/app.ts#@HEAD~2", { kind: "file", path: "src/app.ts", lines: null, revision: "HEAD~2", exists: true }],
    ["src/gone.ts#L1@3f9c0e1", { kind: "file", path: "src/gone.ts", lines: { from: 1, to: 1 }, revision: "3f9c0e1", exists: false }],
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

  it("parses file fragments pinned to a revision", () => {
    expect(parseFileFragment("L2-L5@main")).toEqual({ lines: { from: 2, to: 5 }, revision: "main" });
    expect(parseFileFragment("@feature/x")).toEqual({ lines: null, revision: "feature/x" });
    expect(parseFileFragment("L7")).toEqual({ lines: { from: 7, to: 7 }, revision: null });
    expect(parseFileFragment(undefined)).toEqual({ lines: null, revision: null });
    // Not revisions: left out, the lines stay.
    expect(parseFileFragment("L1@")).toEqual({ lines: { from: 1, to: 1 }, revision: null });
    expect(parseFileFragment("L1@-x")).toEqual({ lines: { from: 1, to: 1 }, revision: null });
  });

  it("accepts only revisions Git can't read as anything else", () => {
    for (const ok of ["v1.0", "main", "HEAD~2", "HEAD^", "feature/GENBEYA-42", "3f9c0e1d2b7a4c58e6f1a9b0d3c7e2f4a8b6c1d0"])
      expect(isRevision(ok), ok).toBe(true);
    for (const bad of ["", "-x", "--output=x", "a..b", "HEAD@{1}", "HEAD:src/a.ts", "a b", "x".repeat(201), 7])
      expect(isRevision(bad), String(bad)).toBe(false);
  });

  it("writes file fragments and shortens commit IDs", () => {
    expect(fileFragment({ lines: { from: 3, to: 9 }, revision: "v1" })).toBe("L3-L9@v1");
    expect(fileFragment({ lines: null, revision: "v1" })).toBe("@v1");
    expect(fileFragment({ lines: { from: 3, to: 3 }, revision: null })).toBe("L3-L3");
    expect(shortRevision("3f9c0e1d2b7a4c58e6f1a9b0d3c7e2f4a8b6c1d0")).toBe("3f9c0e1");
    expect(shortRevision("v0.1.0")).toBe("v0.1.0");
    expect(shortRevision("3f9c0e1")).toBe("3f9c0e1");
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
