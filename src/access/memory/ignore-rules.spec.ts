import { describe, expect, it } from "vitest";
import { ignoreRule } from "../../utilities/gitignore";
import { IgnoreRules } from "./ignore-rules";

const rules = (files: Record<string, string>) => new IgnoreRules(new Map(Object.entries(files)));

describe("IgnoreRules", () => {
  it("matches names at any depth, and anchored paths only below their file's folder", () => {
    const ignore = rules({ ".gitignore": "*.log\n/build\ndocs/tmp.md\n", "src/.gitignore": "/cache/\n" });
    expect(ignore.ignores("app.log")).toBe(true);
    expect(ignore.ignores("src/deep/app.log")).toBe(true);
    expect(ignore.ignores("build/out.js")).toBe(true);
    expect(ignore.ignores("src/build/out.js")).toBe(false);
    expect(ignore.ignores("docs/tmp.md")).toBe(true);
    expect(ignore.ignores("src/cache/x")).toBe(true);
    expect(ignore.ignores("cache/x")).toBe(false);
    expect(ignore.ignores("src/app.ts")).toBe(false);
  });

  it("matches folders only with a trailing slash", () => {
    const ignore = rules({ ".gitignore": "out/\n" });
    expect(ignore.ignores("out/a.txt")).toBe(true);
    expect(ignore.ignores("out")).toBe(false);
  });

  it("lets later and deeper rules win, and takes files back with !", () => {
    const ignore = rules({ ".gitignore": "*.md\n!keep.md\n", "docs/.gitignore": "!*.md\n" });
    expect(ignore.ignores("notes.md")).toBe(true);
    expect(ignore.ignores("keep.md")).toBe(false);
    expect(ignore.ignores("docs/page.md")).toBe(false);
  });

  it("keeps files in an ignored folder ignored", () => {
    expect(rules({ ".gitignore": "/tmp/\n!/tmp/keep\n" }).ignores("tmp/keep")).toBe(true);
  });

  it("understands wildcards, ** and comments", () => {
    const ignore = rules({ ".gitignore": "# comment\n**/cache/**\nfile?.txt\n[ab].bin\n" });
    expect(ignore.ignores("x/cache/y/z")).toBe(true);
    expect(ignore.ignores("file1.txt")).toBe(true);
    expect(ignore.ignores("file10.txt")).toBe(false);
    expect(ignore.ignores("a.bin")).toBe(true);
    expect(ignore.ignores("c.bin")).toBe(false);
    expect(ignore.ignores("# comment")).toBe(false);
  });

  it("reads the rules Genbeya writes literally", () => {
    for (const path of ["notes [draft].md", "a*b.txt", "dir/what?.txt", "trailing .txt "]) {
      const rule = ignoreRule("file", path, "")!;
      const ignore = rules({ ".gitignore": `${rule}\n` });
      expect(ignore.ignores(path)).toBe(true);
    }
    expect(rules({ ".gitignore": "/a\\*b.txt\n" }).ignores("aXb.txt")).toBe(false);
  });
});
