import { describe, expect, it } from "vitest";
import type { PullInput } from "../contracts/model";
import { PullEngine } from "./pull-engine";

const engine = new PullEngine();
const input: PullInput = { title: "Add it", status: "open", source: "feature/x", target: "main", reviewers: ["Alex"], body: "Why.\n" };

describe("PullEngine", () => {
  it("writes a new pull request and reads it back", () => {
    const text = engine.serializeNew("PR-3", input, "Sam");
    expect(text).toBe(
      "---\nid: PR-3\ntitle: Add it\nstatus: open\nauthor: Sam\nsource: feature/x\ntarget: main\nreviewers:\n  - Alex\n---\n\nWhy.\n",
    );
    expect(engine.parse("pulls/PR-3.md", text, "h")).toEqual({
      id: "PR-3",
      path: "pulls/PR-3.md",
      title: "Add it",
      status: "open",
      author: "Sam",
      source: "feature/x",
      target: "main",
      reviewers: ["Alex"],
      mergeCommit: null,
      body: "Why.\n",
      hash: "h",
    });
  });

  it("reads what people write by hand", () => {
    const pull = engine.parse("pulls/PR-1.md", "---\nid: PR-1\nstatus: weird\nreviewers: Alex, Kim\nmerge_commit: abc\n---\nText", "h");
    expect(pull).toMatchObject({ status: "open", reviewers: ["Alex", "Kim"], mergeCommit: null, body: "Text" });
    expect(() => engine.parse("pulls/x.md", "---\ntitle: No ID\n---\n", "h")).toThrow("needs an id");
  });

  it("updates fields in place, keeping others and the line endings", () => {
    const original =
      "---\r\nid: PR-1\r\n# note\r\ntitle: Old\r\ncustom: true\r\nstatus: open\r\nsource: a\r\ntarget: main\r\nreviewers: []\r\n---\r\n\r\nOld.\r\n";
    const merge = "f".repeat(40);
    const updated = engine.serializeUpdate(original, { ...input, title: "New", status: "merged", mergeCommit: merge, body: "New.\n" });
    expect(updated).toContain("# note\r\ntitle: New\r\ncustom: true");
    expect(updated).toContain(`merge_commit: ${merge}`);
    expect(updated.endsWith("\r\n\r\nNew.\r\n")).toBe(true);
    expect(engine.serializeUpdate(updated, { ...input, mergeCommit: null })).not.toContain("merge_commit");
  });

  it("validates input", () => {
    expect(engine.validate({ ...input, reviewers: [" Alex ", "Alex"], title: "  A  title " })).toMatchObject({
      title: "A title",
      reviewers: ["Alex"],
    });
    expect(() => engine.validate({ ...input, status: "done" })).toThrow("Invalid pull request state.");
    expect(() => engine.validate({ ...input, source: "a..b" })).toThrow("not a branch name");
    expect(() => engine.validate({ ...input, title: "" })).toThrow("A title is required");
    expect(() => engine.validate({ ...input, mergeCommit: "abc" })).toThrow("Invalid merge commit.");
  });

  it("knows its files and the next ID", () => {
    expect(engine.isPullFile("pulls/PR-1.md", "pulls")).toBe(true);
    expect(engine.isPullFile("pulls/old/PR-1.md", "pulls")).toBe(false);
    expect(engine.isPullFile("pulls/notes.txt", "pulls")).toBe(false);
    expect(engine.nextId("PR", ["PR-2", "pr-7", "TP-9"])).toBe("PR-8");
    expect(engine.nextId("PR", [], (id) => id === "PR-1")).toBe("PR-2");
  });
});
