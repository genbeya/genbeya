import { describe, expect, it } from "vitest";
import {
  isCommitId,
  LOG_FORMAT,
  parseLog,
  parseNameStatus,
  parseRemotes,
  parseStashes,
  parseStatus,
  parseWorktrees,
  STASH_FORMAT,
} from "./git-parsers";

describe("parseStatus", () => {
  it("reads branch state and every kind of change", () => {
    const { head, changes } = parseStatus(
      "# branch.oid abcdef1234\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\0" +
        "1 .M N... 100644 100644 100644 a a file with spaces.md\0" +
        "2 R. N... 100644 100644 100644 a a R100 new name.md\0old name.md\0" +
        "u UU N... 100644 100644 100644 100644 a a a conflict.txt\0" +
        "? untracked.txt\0",
    );
    expect(head).toEqual({ branch: "main", commit: "abcdef1", upstream: "origin/main", ahead: 2, behind: 1 });
    expect(changes).toEqual([
      { path: "file with spaces.md", index: " ", worktree: "M" },
      { path: "new name.md", oldPath: "old name.md", index: "R", worktree: " " },
      { path: "conflict.txt", index: "U", worktree: "U", conflict: "both-modified" },
      { path: "untracked.txt", index: "?", worktree: "?" },
    ]);
  });

  it("names every kind of conflict", () => {
    const conflict = (xy: string) => `u ${xy} N... 100644 100644 100644 100644 a a a f.txt`;
    const kinds = ["UU", "AA", "DD", "AU", "UA", "DU", "UD"].map((xy) => parseStatus(conflict(xy)).changes[0]?.conflict);
    expect(kinds).toEqual([
      "both-modified",
      "both-added",
      "both-deleted",
      "added-by-us",
      "added-by-them",
      "deleted-by-us",
      "deleted-by-them",
    ]);
  });

  it("handles unborn and detached heads", () => {
    expect(parseStatus("# branch.oid (initial)\0# branch.head main\0").head).toMatchObject({ branch: "main", commit: null });
    expect(parseStatus("# branch.oid 1234567890\0# branch.head (detached)\0").head).toMatchObject({ branch: null, commit: "1234567" });
  });
});

describe("parseLog", () => {
  it("reads commits in LOG_FORMAT", () => {
    expect(LOG_FORMAT.split("%x00").length).toBe(8);
    const hash = "a".repeat(40);
    const output = `${hash}\0${"b".repeat(40)} ${"c".repeat(40)}\0Ann\0ann@x\x002026-01-01T00:00:00Z\0Merge it\0HEAD -> main, tag: v1\0\n`;
    expect(parseLog(output)).toEqual([
      {
        hash,
        parents: ["b".repeat(40), "c".repeat(40)],
        author: "Ann",
        email: "ann@x",
        date: "2026-01-01T00:00:00Z",
        subject: "Merge it",
        refs: ["HEAD -> main", "tag: v1"],
      },
    ]);
    expect(parseLog("")).toEqual([]);
  });
});

describe("parseNameStatus", () => {
  it("keeps the old path of renames", () => {
    expect(parseNameStatus("M\0a.md\0R087\0old.md\0new.md\0A\0b c.md\0")).toEqual([
      { status: "M", path: "a.md" },
      { status: "R", path: "new.md", oldPath: "old.md" },
      { status: "A", path: "b c.md" },
    ]);
  });
});

describe("parseStashes", () => {
  it("reads the branch and message of each stash, newest first", () => {
    expect(STASH_FORMAT.split("%x00").length).toBe(3);
    const a = "a".repeat(40);
    const b = "b".repeat(40);
    const c = "c".repeat(40);
    const output =
      `${a}\x002026-01-02T00:00:00Z\0On feature/x: Half done: really\n` +
      `${b}\x002026-01-01T00:00:00Z\0WIP on main: 1234567 Subject\n` +
      `${c}\x002026-01-01T00:00:00Z\0On (no branch): Detached\n`;
    expect(parseStashes(output)).toEqual([
      { hash: a, index: 0, date: "2026-01-02T00:00:00Z", branch: "feature/x", message: "Half done: really" },
      { hash: b, index: 1, date: "2026-01-01T00:00:00Z", branch: "main", message: "1234567 Subject" },
      { hash: c, index: 2, date: "2026-01-01T00:00:00Z", branch: null, message: "Detached" },
    ]);
    expect(parseStashes("")).toEqual([]);
  });
});

describe("parseWorktrees", () => {
  it("maps branches to their worktrees, skipping stale ones", () => {
    const output =
      "worktree /repo\nHEAD 1\nbranch refs/heads/main\n\n" +
      "worktree /repo/.git/gitdesk/gitdesk\nHEAD 2\nbranch refs/heads/gitdesk\n\n" +
      "worktree /gone\nHEAD 3\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n";
    expect([...parseWorktrees(output)]).toEqual([
      ["refs/heads/main", "/repo"],
      ["refs/heads/gitdesk", "/repo/.git/gitdesk/gitdesk"],
    ]);
  });
});

describe("parseRemotes", () => {
  it("lists fetch URLs once per remote", () => {
    expect(parseRemotes("origin\thttps://x/y.git (fetch)\norigin\thttps://x/y.git (push)\nbackup\t/srv/b (fetch)\n")).toEqual([
      { name: "origin", url: "https://x/y.git" },
      { name: "backup", url: "/srv/b" },
    ]);
  });
});

it("recognises full commit IDs only", () => {
  expect(isCommitId("a".repeat(40))).toBe(true);
  expect(isCommitId("a".repeat(64))).toBe(true);
  expect(isCommitId("abc1234")).toBe(false);
  expect(isCommitId("HEAD")).toBe(false);
  expect(isCommitId(`${"a".repeat(40)};rm`)).toBe(false);
});
