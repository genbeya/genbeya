import { describe, expect, it } from "vitest";
import {
  isCommitId,
  LOG_FORMAT,
  parseFileLog,
  parseGitVersion,
  parseLog,
  parsePushRejection,
  parseNameStatus,
  parseOperation,
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

describe("parseOperation", () => {
  it("reads merges, naming the merged branch, tag or commit", () => {
    const merge = (message: string) => parseOperation({ MERGE_HEAD: "a".repeat(40) + "\n", MERGE_MSG: message }, "main");
    expect(merge("Merge branch 'feature'\n\n# Conflicts:\n#\ta.txt\n")).toEqual({
      kind: "merge",
      source: "feature",
      target: "main",
      step: null,
      steps: null,
    });
    expect(merge("Merge remote-tracking branch 'origin/x' into dev\n")?.source).toBe("origin/x");
    expect(merge("Merge tag 'v1'\n")?.source).toBe("v1");
    expect(merge("Custom message\n")?.source).toBe("aaaaaaa");
  });

  it("reads rebases with their progress, from either backend", () => {
    expect(
      parseOperation(
        {
          "rebase-merge/head-name": "refs/heads/feature\n",
          "rebase-merge/onto": "b".repeat(40) + "\n",
          "rebase-merge/msgnum": "2\n",
          "rebase-merge/end": "5\n",
          MERGE_MSG: "Picked\n",
        },
        null,
      ),
    ).toEqual({ kind: "rebase", source: "feature", target: "b".repeat(40), step: 2, steps: 5 });
    expect(
      parseOperation({ "rebase-apply/head-name": "detached HEAD\n", "rebase-apply/next": "1\n", "rebase-apply/last": "3\n" }, null),
    ).toEqual({ kind: "rebase", source: "detached HEAD", target: null, step: 1, steps: 3 });
  });

  it("reads cherry-picks and reverts by the subject of their commit", () => {
    expect(parseOperation({ CHERRY_PICK_HEAD: "c".repeat(40), MERGE_MSG: "Fix the build\n\nDetails\n" }, "main")).toEqual({
      kind: "cherry-pick",
      source: "Fix the build",
      target: "main",
      step: null,
      steps: null,
    });
    expect(parseOperation({ REVERT_HEAD: "d".repeat(40), MERGE_MSG: 'Revert "Fix the build"\n\nThis reverts' }, "main")?.source).toBe(
      "Fix the build",
    );
  });

  it("finds nothing in progress without those files", () => {
    expect(parseOperation({ MERGE_MSG: "left over\n" }, "main")).toBeNull();
  });
});

describe("parseFileLog", () => {
  const header = (hash: string, subject: string) => `\0${hash.repeat(40)}\0Ada L\x002026-10-10T14:32:00+02:00\0${subject}\n\n`;
  // `git log --follow -p` of tasks/TP-1.md: moved back without edits, moved to an epic and edited, created.
  const output =
    header("a", "Pure move") +
    'diff --git a/tasks/Auth x/TP-1.md b/tasks/TP-1.md\nsimilarity index 100%\nrename from "tasks/Auth x/T\\"P-1.md"\nrename to tasks/TP-1.md\n' +
    header("b", "Move") +
    'diff --git a/tasks/TP-1.md b/tasks/Auth x/TP-1.md\nsimilarity index 71%\nrename from tasks/TP-1.md\nrename to tasks/Auth x/T"P-1.md\n' +
    "index 5904535..b8ea4a2 100644\n--- a/tasks/TP-1.md\n+++ b/tasks/Auth x/TP-1.md\t\n" +
    "@@ -1,6 +1,6 @@\n ---\n id: TP-1\n-status: todo\n+status: done\n ---\n \n Text\n\\ No newline at end of file\n" +
    header("c", "Create TP-1") +
    "diff --git a/tasks/TP-1.md b/tasks/TP-1.md\nnew file mode 100644\nindex 0000000..5904535\n--- /dev/null\n+++ b/tasks/TP-1.md\n" +
    "@@ -0,0 +1,6 @@\n+---\n+id: TP-1\n+status: todo\n+---\n+\n+Text\n";

  it("reads each commit's paths and both versions of the file", () => {
    const meta = { author: "Ada L", date: "2026-10-10T14:32:00+02:00" };
    expect(parseFileLog(output, "tasks/TP-1.md", true)).toEqual([
      {
        ...meta,
        hash: "a".repeat(40),
        subject: "Pure move",
        path: "tasks/TP-1.md",
        oldPath: 'tasks/Auth x/T"P-1.md',
        before: null,
        after: null,
      },
      {
        ...meta,
        hash: "b".repeat(40),
        subject: "Move",
        path: 'tasks/Auth x/T"P-1.md',
        oldPath: "tasks/TP-1.md",
        before: "---\nid: TP-1\nstatus: todo\n---\n\nText\n",
        after: "---\nid: TP-1\nstatus: done\n---\n\nText\n",
      },
      {
        ...meta,
        hash: "c".repeat(40),
        subject: "Create TP-1",
        path: "tasks/TP-1.md",
        oldPath: null,
        before: null,
        after: "---\nid: TP-1\nstatus: todo\n---\n\nText\n",
      },
    ]);
  });

  it("leaves the versions out when the patches do not hold whole files", () => {
    const revisions = parseFileLog(output, "tasks/TP-1.md", false);
    expect(revisions.map((revision) => [revision.oldPath, revision.path, revision.before, revision.after])).toEqual([
      ['tasks/Auth x/T"P-1.md', "tasks/TP-1.md", null, null],
      ["tasks/TP-1.md", 'tasks/Auth x/T"P-1.md', null, null],
      [null, "tasks/TP-1.md", null, null],
    ]);
  });

  it("skips commits without a patch and binary files' contents", () => {
    const binary = `${header("d", "Merge")}${header("e", "Binary")}diff --git a/x b/x\nindex 1..2 100644\nBinary files a/x and b/x differ\n`;
    expect(parseFileLog(binary, "x", true)).toEqual([
      expect.objectContaining({ subject: "Binary", before: null, after: null, oldPath: "x" }),
    ]);
    expect(parseFileLog("", "x", true)).toEqual([]);
  });

  it("ends with the commit that added the file", () => {
    const deleted = `${header("d", "Delete")}diff --git a/tasks/TP-1.md b/tasks/TP-1.md\ndeleted file mode 100644\n`;
    expect(parseFileLog(output + deleted, "tasks/TP-1.md", false).map((revision) => revision.subject)).toEqual([
      "Pure move",
      "Move",
      "Create TP-1",
    ]);
    expect(parseFileLog(deleted + output, "tasks/TP-1.md", false)).toEqual([]);
  });

  it("unquotes octal escapes as UTF-8", () => {
    const quoted = `${header("f", "Rename")}diff --git a/a b/b\nsimilarity index 100%\nrename from "tasks/\\303\\251\\t.md"\nrename to b\n`;
    expect(parseFileLog(quoted, "b", true)[0]!.oldPath).toBe("tasks/é\t.md");
  });
});

describe("parseWorktrees", () => {
  it("maps branches to their worktrees, skipping stale ones", () => {
    const output =
      "worktree /repo\nHEAD 1\nbranch refs/heads/main\n\n" +
      "worktree /repo/.git/genbeya/genbeya\nHEAD 2\nbranch refs/heads/genbeya\n\n" +
      "worktree /gone\nHEAD 3\nbranch refs/heads/old\nprunable gitdir file points to non-existent location\n";
    expect([...parseWorktrees(output)]).toEqual([
      ["refs/heads/main", "/repo"],
      ["refs/heads/genbeya", "/repo/.git/genbeya/genbeya"],
    ]);
  });
});

describe("parseGitVersion", () => {
  it("reads the version of every build of git", () => {
    expect(parseGitVersion("git version 2.53.0.windows.1\n")).toEqual({ major: 2, minor: 53, patch: 0 });
    expect(parseGitVersion("git version 2.39.5 (Apple Git-154)")).toEqual({ major: 2, minor: 39, patch: 5 });
    expect(parseGitVersion("git version 2.30")).toEqual({ major: 2, minor: 30, patch: 0 });
    expect(parseGitVersion("not git")).toBeNull();
  });
});

describe("parsePushRejection", () => {
  it("tells a failed lease from a remote that has other commits", () => {
    const line = (reason: string) => ` ! [rejected]        main -> main (${reason})\nerror: failed to push some refs to '/srv/x.git'\n`;
    expect(parsePushRejection(line("non-fast-forward"))).toBe("behind");
    expect(parsePushRejection(line("fetch first"))).toBe("behind");
    expect(parsePushRejection(line("stale info"))).toBe("stale");
    expect(parsePushRejection(line("remote ref updated since checkout"))).toBe("stale");
    expect(parsePushRejection(" ! [remote rejected] main -> main (pre-receive hook declined)\n")).toBeNull();
    expect(parsePushRejection("fatal: could not read from remote repository\n")).toBeNull();
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
