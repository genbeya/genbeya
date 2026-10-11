import { describe, expect, it } from "vitest";
import { appendIgnoreRule, escapeIgnorePattern, extensionOf, ignoreFile, ignoreLocations, ignoreRule } from "./gitignore";

describe("gitignore rules", () => {
  it.each([
    ["plain.txt", "plain.txt"],
    ["a*b?.txt", "a\\*b\\?.txt"],
    ["[x].md", "\\[x].md"],
    ["back\\slash", "back\\\\slash"],
    ["trailing  ", "trailing\\ \\ "],
    ["#hash", "#hash"],
  ])("escapes %j", (name, escaped) => {
    expect(escapeIgnorePattern(name)).toBe(escaped);
  });

  it.each([
    ["file", "src/app/out.log", "", "/src/app/out.log"],
    ["file", "src/app/out.log", "src/app", "/out.log"],
    ["file", "#notes!.txt", "", "/#notes!.txt"],
    ["file", "src/[id]/page.ts", "", "/src/\\[id]/page.ts"],
    ["folder", "src/build", "", "/src/build/"],
    ["folder", "src/build", "src", "/build/"],
    ["extension", "src/app/out.log", "", "*.log"],
    ["extension", "src/app/out.log", "src/app", "*.log"],
    ["extension", "src/.env", "", null],
    ["file", "src/app/out.log", "lib", null],
    ["file", "srcx/out.log", "src", null],
  ] as const)("writes the %s rule of %s in %j", (kind, path, location, rule) => {
    expect(ignoreRule(kind, path, location)).toBe(rule);
  });

  it("finds extensions", () => {
    expect(extensionOf("a/b.spec.ts")).toBe("ts");
    expect(extensionOf(".gitignore")).toBeNull();
    expect(extensionOf("Makefile")).toBeNull();
    expect(extensionOf("odd.")).toBeNull();
  });

  it("offers the root and the folder holding a path", () => {
    expect(ignoreLocations("top.txt")).toEqual([""]);
    expect(ignoreLocations("src/client/app.ts")).toEqual(["", "src/client"]);
    expect(ignoreFile("")).toBe(".gitignore");
    expect(ignoreFile("src")).toBe("src/.gitignore");
  });

  it("appends a line in the file's line endings, ending with one", () => {
    expect(appendIgnoreRule("", "/a")).toBe("/a\n");
    expect(appendIgnoreRule("node_modules/\n", "/a")).toBe("node_modules/\n/a\n");
    expect(appendIgnoreRule("node_modules/", "/a")).toBe("node_modules/\n/a\n");
    expect(appendIgnoreRule("x\r\ny", "/a")).toBe("x\r\ny\r\n/a\r\n");
    expect(appendIgnoreRule("﻿x\r\n", "/a")).toBe("﻿x\r\n/a\r\n");
  });

  it("does not add a rule twice", () => {
    expect(appendIgnoreRule("x\r\n/a\r\n", "/a")).toBeNull();
  });
});
