import { describe, expect, it } from "vitest";
import { baseName, parentOf, validateRepositoryPath, within } from "./repository-path";

describe("validateRepositoryPath", () => {
  it.each(["docs/Home.md", "a", "src/deep/file name.ts", ".gitignore", ".github/workflows/x.yml"])("accepts %s", (path) => {
    expect(validateRepositoryPath(path, false)).toBe(path);
    expect(validateRepositoryPath(path, true)).toBe(path);
  });

  it.each(["", "../x", "docs/../../x", "./x", "/etc/passwd", "C:/x", "c:x", "docs\\Home.md", ".git", ".git/config", ".git./config", ".GIT/config", "a//b", "a/"])(
    "rejects %s on every platform",
    (path) => {
      expect(() => validateRepositoryPath(path, false)).toThrow();
      expect(() => validateRepositoryPath(path, true)).toThrow();
    },
  );

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
