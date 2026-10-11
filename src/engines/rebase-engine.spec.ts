import { describe, expect, it } from "vitest";
import type { RebaseCommit, RebaseStep } from "../contracts/model";
import { RebaseEngine } from "./rebase-engine";

const commit = (hash: string, message = `Commit ${hash}`, merge = false): RebaseCommit => ({
  hash,
  subject: message.split("\n")[0]!,
  message,
  author: "Ann",
  date: "2026-01-01T00:00:00Z",
  merge,
});
const commits = [commit("a"), commit("b"), commit("c"), commit("d")];
const engine = new RebaseEngine();
const todo = (steps: RebaseStep[], list = commits) => engine.todo(list, steps);
const picks = (...hashes: string[]): RebaseStep[] => hashes.map((hash) => ({ hash, action: "pick" }));

describe("RebaseEngine", () => {
  it("picks commits in their new order and drops the dropped ones", () => {
    expect(todo([...picks("b", "a"), { hash: "c", action: "drop" }, ...picks("d")])).toEqual({
      lines: [
        { command: "pick", hash: "b" },
        { command: "pick", hash: "a" },
        { command: "drop", hash: "c" },
        { command: "pick", hash: "d" },
      ],
      messages: [],
    });
  });

  it("rewords by amending right after the pick, unless the message stays the same", () => {
    expect(
      todo([
        { hash: "a", action: "reword", message: "  Better words  " },
        { hash: "b", action: "reword", message: "Commit b" },
        ...picks("c", "d"),
      ]),
    ).toEqual({
      lines: [
        { command: "pick", hash: "a" },
        { command: "amend", message: 0 },
        { command: "pick", hash: "b" },
        { command: "pick", hash: "c" },
        { command: "pick", hash: "d" },
      ],
      messages: ["Better words"],
    });
  });

  it("turns squashes into fixups and amends the joined or chosen message", () => {
    const { lines, messages } = todo([...picks("a"), { hash: "b", action: "squash" }, { hash: "c", action: "fixup" }, ...picks("d")]);
    expect(lines).toEqual([
      { command: "pick", hash: "a" },
      { command: "fixup", hash: "b" },
      { command: "fixup", hash: "c" },
      { command: "amend", message: 0 },
      { command: "pick", hash: "d" },
    ]);
    expect(messages).toEqual(["Commit a\n\nCommit b"]);
    expect(todo([...picks("a", "b"), { hash: "c", action: "squash", message: "All of it" }, ...picks("d")]).messages).toEqual([
      "All of it",
    ]);
  });

  it("joins a squash without a message of its own from the commits before it in their new order, as reworded", () => {
    expect(todo([...picks("c"), { hash: "a", action: "squash" }, { hash: "b", action: "squash" }, ...picks("d")]).messages).toEqual([
      "Commit c\n\nCommit a\n\nCommit b",
    ]);
    expect(
      todo([{ hash: "b", action: "reword", message: "Better" }, { hash: "a", action: "squash" }, ...picks("c", "d")]).messages,
    ).toEqual(["Better\n\nCommit a"]);
  });

  it("keeps the first commit's message for fixups alone", () => {
    expect(todo([...picks("a"), { hash: "b", action: "fixup" }, ...picks("c", "d")]).messages).toEqual([]);
  });

  it("refuses squashing without an earlier commit, missing messages, changed commits and merges", () => {
    expect(() => todo([{ hash: "a", action: "drop" }, { hash: "b", action: "squash" }, ...picks("c", "d")])).toThrow(
      "Commit b has no earlier commit to be squashed into.",
    );
    expect(() => todo([{ hash: "a", action: "reword", message: " " }, ...picks("b", "c", "d")])).toThrow("Write a message for Commit a.");
    expect(() => todo(picks("a", "b", "c"))).toThrow("The commits changed meanwhile.");
    expect(() => todo(picks("a", "a", "b", "c"))).toThrow("The commits changed meanwhile.");
    expect(() => todo(picks("a", "b", "c", "x"))).toThrow("The commits changed meanwhile.");
    expect(() => todo(picks("a", "m"), [commit("a"), commit("m", "Merge", true)])).toThrow(/merge/);
  });
});
