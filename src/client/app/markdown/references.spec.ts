import { referenceCandidates, referenceTargets, resolveReference, type ReferenceSources } from "./references";

const sources: ReferenceSources = {
  wikiRoot: "docs",
  pages: [
    { title: "Home", path: "docs/Home.md" },
    { title: "Wiki", path: "docs/Guide/Wiki.md" },
    { title: "Tasks", path: "docs/Guide/Tasks.md" },
  ],
  tasks: [
    { id: "GENBEYA-12", path: "tasks/GENBEYA-12.md", title: "Virtualize lists", status: "in-progress" },
    { id: "GENBEYA-3", path: "tasks/Auth/GENBEYA-3.md", title: "Old state", status: "blocked" },
  ],
  statuses: ["backlog", "in-progress", "done"],
  files: ["src/app.ts", "src/util/path.ts", "README.md", "docs/Home.md"],
};
const targets = referenceTargets(sources);

describe("resolveReference", () => {
  it("finds tasks by ID, with their title, status and the status's colour", () => {
    expect(resolveReference("GENBEYA-12", targets)).toEqual({
      kind: "task",
      id: "GENBEYA-12",
      path: "tasks/GENBEYA-12.md",
      title: "Virtualize lists",
      status: "in-progress",
      tone: "blue",
    });
    expect(resolveReference("genbeya-12", targets)).toMatchObject({ kind: "task", id: "GENBEYA-12" });
    expect(resolveReference("GENBEYA-3", targets)).toMatchObject({ kind: "task", tone: "other" });
  });

  it("finds pages by title, or by path below the wiki folder or from the repository root", () => {
    expect(resolveReference("Home", targets)).toEqual({ kind: "page", path: "docs/Home.md", title: "Home" });
    expect(resolveReference("guide wiki", targets)).toMatchObject({ kind: "missing-page" });
    expect(resolveReference("Guide/Wiki", targets)).toEqual({ kind: "page", path: "docs/Guide/Wiki.md", title: "Wiki" });
    expect(resolveReference("docs/Guide/Tasks.md", targets)).toEqual({ kind: "page", path: "docs/Guide/Tasks.md", title: "Tasks" });
    expect(resolveReference("Guide/Wiki#Links", targets)).toEqual({
      kind: "page",
      path: "docs/Guide/Wiki.md",
      title: "Wiki",
      anchor: "Links",
    });
  });

  it("finds files by path, with an optional line or line range", () => {
    expect(resolveReference("src/app.ts", targets)).toEqual({ kind: "file", path: "src/app.ts", lines: null, exists: true });
    expect(resolveReference("src/util/path.ts#L10", targets)).toMatchObject({ lines: { from: 10, to: 10 } });
    expect(resolveReference("src/util/path.ts#L10-L20", targets)).toMatchObject({ lines: { from: 10, to: 20 } });
    expect(resolveReference("src/util/path.ts#L20-10", targets)).toMatchObject({ lines: { from: 10, to: 20 } });
    expect(resolveReference("/README.md", targets)).toMatchObject({ kind: "file", path: "README.md", exists: true });
  });

  it("marks references that point nowhere", () => {
    expect(resolveReference("Glossary", targets)).toEqual({ kind: "missing-page", title: "Glossary" });
    expect(resolveReference("src/gone.ts#L3", targets)).toEqual({
      kind: "file",
      path: "src/gone.ts",
      lines: { from: 3, to: 3 },
      exists: false,
    });
    // Paths never leave the repository.
    expect(resolveReference("../outside.txt", targets)).toEqual({ kind: "missing-page", title: "../outside.txt" });
  });

  it("prefers tasks over pages and pages over files", () => {
    const shadowed = referenceTargets({ ...sources, pages: [{ title: "GENBEYA-12", path: "docs/GENBEYA-12.md" }] });
    expect(resolveReference("GENBEYA-12", shadowed)).toMatchObject({ kind: "task" });
    expect(resolveReference("docs/Home.md", targets)).toMatchObject({ kind: "page" });
  });
});

describe("referenceCandidates", () => {
  it("offers tasks, pages and the remaining files, with paths for repeated titles", () => {
    const candidates = referenceCandidates({ ...sources, pages: [...sources.pages, { title: "Wiki", path: "docs/Old/Wiki.md" }] });
    expect(candidates.map((candidate) => [candidate.kind, candidate.target, candidate.label])).toEqual([
      ["task", "GENBEYA-12", "GENBEYA-12 Virtualize lists"],
      ["task", "GENBEYA-3", "GENBEYA-3 Old state"],
      ["page", "Home", "Home"],
      ["page", "Guide/Wiki", "Guide/Wiki"],
      ["page", "Tasks", "Tasks"],
      ["page", "Old/Wiki", "Old/Wiki"],
      ["file", "src/app.ts", "src/app.ts"],
      ["file", "src/util/path.ts", "src/util/path.ts"],
      ["file", "README.md", "README.md"],
    ]);
  });
});
