import { describe, expect, it } from "vitest";
import {
  changeBase,
  commitMessage,
  conflictResolution,
  diffSource,
  historyRange,
  linePatch,
  plainRef,
  pushForce,
  rebaseSteps,
  refName,
  remoteDefinition,
  stashOptions,
} from "./version-control-arguments";

const HASH = "a".repeat(40);

describe("version control arguments", () => {
  it("refuses refs Git could read as options", () => {
    expect(plainRef("feature/x")).toBe("feature/x");
    expect(() => plainRef("origin/-x")).toThrow("looks like an option");
    expect(() => refName("-x", "branch")).toThrow("Invalid branch name.");
    expect(() => refName("", "tag")).toThrow("Invalid tag name.");
  });

  it("reads comparison bases and diff sources", () => {
    expect(changeBase(undefined)).toBe("head");
    expect(changeBase("parent")).toBe("parent");
    expect(() => changeBase("tree")).toThrow("Invalid comparison base.");
    expect(diffSource({ commit: HASH })).toEqual({ commit: HASH });
    expect(() => diffSource({ commit: "HEAD" })).toThrow("Invalid diff source.");
  });

  it("checks line selections and their diff version", () => {
    const path = (value: unknown) => String(value);
    const lines = { original: [{ from: 2, to: 3 }], modified: [] };
    expect(linePatch({ path: "a.txt", version: "f".repeat(64), lines }, path)).toEqual({ path: "a.txt", version: "f".repeat(64), lines });
    expect(() => linePatch({ path: "a.txt", version: "x", lines }, path)).toThrow("Invalid diff version.");
    expect(() =>
      linePatch({ path: "a.txt", version: "f".repeat(64), lines: { original: [{ from: 3, to: 2 }], modified: [] } }, path),
    ).toThrow("Invalid line selection.");
  });

  it("checks messages, ranges, remotes, stashes, pushes, rebases and resolutions", () => {
    expect(commitMessage("  Fix it \n")).toBe("Fix it");
    expect(() => commitMessage("   ")).toThrow("Write a commit message first.");
    expect(() => historyRange(0, 1001)).toThrow("Invalid history range.");
    expect(remoteDefinition("origin", " https://example.com/x.git ")).toEqual({ name: "origin", url: "https://example.com/x.git" });
    expect(() => remoteDefinition("my remote", "x")).toThrow("Remote names");
    expect(stashOptions({ message: " wip ", includeUntracked: true })).toEqual({
      message: "wip",
      includeUntracked: true,
      keepIndex: false,
    });
    expect(() => stashOptions({ message: "a\nb" })).toThrow("one line");
    expect(pushForce(undefined)).toBeUndefined();
    expect(pushForce({ expected: null, defaultBranch: false })).toEqual({ expected: null, defaultBranch: false });
    expect(() => pushForce({ expected: "main", defaultBranch: false })).toThrow("Invalid push.");
    expect(rebaseSteps([{ hash: HASH, action: "squash", message: "Both" }])).toEqual([{ hash: HASH, action: "squash", message: "Both" }]);
    expect(() => rebaseSteps([{ hash: HASH, action: "edit" }])).toThrow("Invalid rebase steps.");
    expect(conflictResolution({ use: "text", text: "merged" })).toEqual({ use: "text", text: "merged" });
    expect(() => conflictResolution({ use: "both" })).toThrow("Invalid resolution.");
  });
});
