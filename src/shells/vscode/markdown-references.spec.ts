import { describe, expect, it } from "vitest";
import { codeRanges, openReference, referencesIn } from "./markdown-references";

describe("referencesIn", () => {
  it("finds references with their offsets and targets, labels left out", () => {
    const text = "See [[GENBEYA-12]] and [[Home|the start]].";
    expect(referencesIn(text)).toEqual([
      { start: 4, end: 18, target: "GENBEYA-12" },
      { start: 23, end: 41, target: "Home" },
    ]);
  });

  it("skips references in code blocks and inline code", () => {
    const text = ["`[[Inline]]` [[Real]]", "```", "[[Fenced]]", "```", "~~~~md", "[[Tilde]]", "```", "~~~~", "[[After]]"].join("\n");
    expect(referencesIn(text).map((link) => link.target)).toEqual(["Real", "After"]);
  });

  it("treats an unclosed fence as code to the end", () => {
    expect(referencesIn("[[Before]]\n```\n[[Inside]]").map((link) => link.target)).toEqual(["Before"]);
  });
});

describe("codeRanges", () => {
  it("covers a fence from its opening to its closing line", () => {
    const text = "a\n```js\ncode\n```\nb";
    expect(codeRanges(text)).toEqual([[2, 16]]);
  });
});

describe("openReference", () => {
  it("gives the text typed after an unclosed [[", () => {
    expect(openReference("See [[GENB")).toBe("GENB");
    expect(openReference("See [[")).toBe("");
    expect(openReference("See [[Done]] and")).toBeNull();
    expect(openReference("See [[Page|lab")).toBeNull();
  });
});
