import { describe, expect, it } from "vitest";
import { parseFolderLog } from "./folder-history";

describe("parseFolderLog", () => {
  it("reads each commit's files as they are after it, and deleted ones", () => {
    const log = [
      ["", "bbb", "Sam", "2026-10-02T10:00:00+02:00", "Second"].join("\0"),
      "diff --git a/tasks/A.md b/tasks/A.md",
      "index 1..2 100644",
      "--- a/tasks/A.md",
      "+++ b/tasks/A.md",
      "@@ -1,2 +1,2 @@",
      " id: A",
      "-remaining: 4h",
      "+remaining: 2h",
      "diff --git a/tasks/B.md b/tasks/B.md",
      "deleted file mode 100644",
      "--- a/tasks/B.md",
      "+++ /dev/null",
      "@@ -1 +0,0 @@",
      "-id: B",
      "",
      ["", "aaa", "Ada", "2026-10-01T10:00:00+02:00", "First"].join("\0"),
      "diff --git a/tasks/A.md b/tasks/A.md",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/tasks/A.md",
      "@@ -0,0 +1,2 @@",
      "+id: A",
      "+remaining: 4h",
    ].join("\n");
    expect(parseFolderLog(log)).toEqual([
      {
        hash: "bbb",
        author: "Sam",
        date: "2026-10-02T10:00:00+02:00",
        subject: "Second",
        files: [
          { path: "tasks/A.md", content: "id: A\nremaining: 2h\n" },
          { path: "tasks/B.md", content: null },
        ],
      },
      {
        hash: "aaa",
        author: "Ada",
        date: "2026-10-01T10:00:00+02:00",
        subject: "First",
        files: [{ path: "tasks/A.md", content: "id: A\nremaining: 4h\n" }],
      },
    ]);
  });
});
