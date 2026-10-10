import { describe, expect, it } from "vitest";
import { baseName, parentOf, relativeLinkPath, relocate, resolveLinkPath, validateRepositoryPath, within } from "./repository-path";

describe("validateRepositoryPath", () => {
  it.each(["docs/Home.md", "a", "src/deep/file name.ts", ".gitignore", ".github/workflows/x.yml"])("accepts %s", (path) => {
    expect(validateRepositoryPath(path, false)).toBe(path);
    expect(validateRepositoryPath(path, true)).toBe(path);
  });

  it.each([
    "",
    "../x",
    "docs/../../x",
    "./x",
    "/etc/passwd",
    "C:/x",
    "c:x",
    "docs\\Home.md",
    ".git",
    ".git/config",
    ".git./config",
    ".GIT/config",
    "a//b",
    "a/",
  ])("rejects %s on every platform", (path) => {
    expect(() => validateRepositoryPath(path, false)).toThrow();
    expect(() => validateRepositoryPath(path, true)).toThrow();
  });

  it.each(["GIT~1/config", "code.ts:stream", "docs/Home.md.", "docs/Home.md ", "con", "NUL.txt", "a/lpt1", "q?.md", "x\u0001"])(
    "rejects the Windows alias or reserved name %s on Windows only",
    (path) => {
      expect(() => validateRepositoryPath(path, true)).toThrow();
    },
  );

  it("rejects non-strings, NUL bytes and overlong paths", () => {
    expect(() => validateRepositoryPath(42, false)).toThrow("Invalid path.");
    expect(() => validateRepositoryPath("a\0b", false)).toThrow("Invalid path.");
    expect(() => validateRepositoryPath("a".repeat(4097), false)).toThrow("Invalid path.");
  });
});

describe("path helpers", () => {
  it("tests containment by whole segments", () => {
    expect(within("docs/Home.md", "docs")).toBe(true);
    expect(within("docs-old/Home.md", "docs")).toBe(false);
    expect(within("docs", "docs")).toBe(false);
    expect(within("anything", "")).toBe(true);
  });

  it("splits parents and base names", () => {
    expect(parentOf("docs/a/b.md")).toBe("docs/a");
    expect(parentOf("b.md")).toBe("");
    expect(baseName("docs/a/b.md")).toBe("b.md");
    expect(baseName("b.md")).toBe("b.md");
  });
});

describe("link paths", () => {
  it.each([
    ["docs/Guide/Wiki.md", "Tasks.md", "docs/Guide/Tasks.md"],
    ["docs/Guide/Wiki.md", "../Home.md", "docs/Home.md"],
    ["docs/Guide/Wiki.md", "./Sub/Page.md", "docs/Guide/Sub/Page.md"],
    ["docs/Home.md", "/src/main.ts", "src/main.ts"],
    ["docs/Home.md", "../../../etc/passwd", "etc/passwd"],
    ["README.md", "docs/Home.md", "docs/Home.md"],
  ])("resolves a link in %s to %s", (from, target, expected) => {
    expect(resolveLinkPath(from, target)).toBe(expected);
  });

  it.each([
    ["docs/Guide/Wiki.md", "docs/Guide/Tasks.md", "Tasks.md"],
    ["docs/Guide/Wiki.md", "docs/Home.md", "../Home.md"],
    ["docs/Home.md", "docs/Guide/Sub/Page.md", "Guide/Sub/Page.md"],
    ["docs/A/B.md", "docs/C/D.md", "../C/D.md"],
    ["README.md", "docs/Home.md", "docs/Home.md"],
    ["docs/Home.md", "README.md", "../README.md"],
    ["docs/Home.md", "docs/Home.md", "Home.md"],
  ])("links from %s to %s as %s", (from, to, expected) => {
    expect(relativeLinkPath(from, to)).toBe(expected);
    expect(resolveLinkPath(from, expected)).toBe(to);
  });

  it("relocates paths below moved entries", () => {
    const moves = [
      ["docs/A.md", "docs/B/A.md"],
      ["docs/A", "docs/B/A"],
    ] as const;
    expect(relocate("docs/A.md", moves)).toBe("docs/B/A.md");
    expect(relocate("docs/A/x/y.png", moves)).toBe("docs/B/A/x/y.png");
    expect(relocate("docs/A", moves)).toBe("docs/B/A");
    expect(relocate("docs/AB.md", moves)).toBeNull();
    expect(relocate("docs/A.md.bak", moves)).toBeNull();
  });
});
