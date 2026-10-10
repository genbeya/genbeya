import { describe, expect, it } from "vitest";
import type { TaskInput } from "../contracts/model";
import { TaskEngine } from "./task-engine";

const engine = new TaskEngine();
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);
const statuses = ["backlog", "todo", "done"];
const input: TaskInput = {
  title: "Build it",
  status: "backlog",
  priority: "high",
  assignee: "alice",
  labels: ["backend"],
  body: "Useful work.\n\n- [ ] Done\n",
  epic: "",
};

describe("TaskEngine.parse", () => {
  it("reads the frontmatter fields and the body", () => {
    const task = engine.parse("tasks/TP-1.md", "---\nid: TP-1\ntitle: One\nstatus: todo\nlabels: [a, b]\n---\n\nBody\n", "h", "tasks");
    expect(task).toEqual({
      id: "TP-1",
      path: "tasks/TP-1.md",
      title: "One",
      status: "todo",
      priority: "none",
      assignee: "",
      labels: ["a", "b"],
      body: "Body\n",
      epic: "",
      hash: "h",
      comments: [],
    });
  });

  it("accepts comma-separated labels and CRLF files", () => {
    const task = engine.parse("t.md", "---\r\nid: 7\r\ntitle: T\r\nstatus: done\r\nlabels: a, b\r\n---\r\n", "h", "tasks");
    expect(task.id).toBe("7");
    expect(task.labels).toEqual(["a", "b"]);
  });

  it("reads files that start with a byte order mark", () => {
    expect(
      engine.parse(
        "t.md",
        `${BOM}---
id: 7
title: T
status: done
---
`,
        "h",
        "tasks",
      ).id,
    ).toBe("7");
  });

  it.each([
    ["no frontmatter", "Just text\n", "id, title and status"],
    ["missing status", "---\nid: 1\ntitle: T\n---\n", "id, title and status"],
    ["broken YAML", "---\nid: [broken\n---\n", "Invalid YAML frontmatter"],
    ["a list", "---\n- a\n---\n", "YAML mapping"],
  ])("rejects %s", (_, content, message) => {
    expect(() => engine.parse("t.md", content, "h", "tasks")).toThrow(message);
  });
});

describe("TaskEngine epics", () => {
  it("are the folders tasks live in below the task folder", () => {
    const content = "---\nid: TP-1\ntitle: One\nstatus: todo\n---\n";
    expect(engine.parse("tasks/TP-1.md", content, "h", "tasks").epic).toBe("");
    expect(engine.parse("tasks/Login rework/TP-1.md", content, "h", "tasks").epic).toBe("Login rework");
    expect(engine.parse("work/tasks/Auth/Tokens/TP-1.md", content, "h", "work/tasks").epic).toBe("Auth/Tokens");
  });

  it("place a task's file", () => {
    expect(engine.pathOf("tasks", "", "TP-1")).toBe("tasks/TP-1.md");
    expect(engine.pathOf("tasks", "Auth/Tokens", "TP-1")).toBe("tasks/Auth/Tokens/TP-1.md");
  });

  it("keep the spelling of an existing folder that differs only in case", () => {
    const files = ["tasks/Auth/TP-1.md", "tasks/Auth/Tokens/TP-2.md", "tasks/TP-3.md", "docs/auth/x.md"];
    expect(engine.existingSpelling("auth", files, "tasks")).toBe("Auth");
    expect(engine.existingSpelling("AUTH/tokens", files, "tasks")).toBe("Auth/Tokens");
    expect(engine.existingSpelling("auth/New", files, "tasks")).toBe("Auth/New");
    expect(engine.existingSpelling("Billing", files, "tasks")).toBe("Billing");
    expect(engine.existingSpelling("", files, "tasks")).toBe("");
  });
});

describe("TaskEngine.validate", () => {
  it("normalises the input", () => {
    expect(engine.validate({ ...input, title: "  Two\nlines ", priority: " ", labels: ["x", " x", ""] }, statuses)).toEqual({
      ...input,
      title: "Two lines",
      priority: "none",
      labels: ["x"],
    });
    expect(engine.validate({ ...input, epic: " Auth / Tokens/ " }, statuses).epic).toBe("Auth/Tokens");
  });

  it.each([
    [{ title: " " }, "needs a title"],
    [{ status: "nope" }, "workflow states"],
    [{ labels: Array.from({ length: 31 }, (_, i) => `l${i}`) }, "at most 30 labels"],
    [{ assignee: 5 }, "Invalid assignee"],
    [{ labels: "a" }, "at most 30 labels"],
    [{ epic: "../outside" }, "epic"],
    [{ epic: ".git" }, "epic"],
    [{ epic: "x".repeat(121) }, "epic"],
    [{ epic: 3 }, "epic"],
  ])("rejects %j", (change, message) => {
    expect(() => engine.validate({ ...input, ...change } as unknown as TaskInput, statuses)).toThrow(message);
  });
});

describe("TaskEngine serialisation", () => {
  it("writes new tasks with only the fields that have values", () => {
    expect(engine.serializeNew("TP-1", { ...input, assignee: "", labels: [] })).toBe(
      "---\nid: TP-1\ntitle: Build it\nstatus: backlog\npriority: high\n---\n\nUseful work.\n\n- [ ] Done\n",
    );
  });

  it("round-trips through parse", () => {
    const task = engine.parse("tasks/TP-1.md", engine.serializeNew("TP-1", input), "h", "tasks");
    expect({ ...task, hash: undefined, id: undefined, path: undefined, comments: undefined }).toEqual({
      ...input,
      hash: undefined,
      id: undefined,
      path: undefined,
    });
  });

  it("updates known fields in place and keeps comments and unknown fields", () => {
    const original = "---\n# keep me\nid: TP-1\nestimate: 3\ntitle: Old\nstatus: todo\nlabels: [x]\n---\n\nOld body\n";
    const updated = engine.serializeUpdate(original, { ...input, labels: [] });
    expect(updated).toContain("# keep me");
    expect(updated).toContain("estimate: 3");
    expect(updated).toContain("title: Build it");
    expect(updated).not.toContain("labels");
    expect(updated.endsWith("- [ ] Done\n")).toBe(true);
  });

  it("keeps the byte order mark and CRLF line endings of the file", () => {
    const original = `${BOM}---\nid: TP-1\ntitle: Old\nstatus: todo\n---\n\nOld\nbody\n`.split("\n").join(CRLF);
    const updated = engine.serializeUpdate(original, { ...input, body: "New\nbody\n" });
    expect(updated.startsWith(`${BOM}---${CRLF}id: TP-1${CRLF}`)).toBe(true);
    expect(updated.endsWith(`New${CRLF}body${CRLF}`)).toBe(true);
    expect(updated.split(CRLF).join("")).not.toContain("\n");
    expect(engine.parse("t.md", updated, "h", "tasks")).toMatchObject({ title: "Build it", body: `New${CRLF}body${CRLF}` });
  });

  it("does not add a priority the file did not have", () => {
    const original = "---\nid: TP-1\ntitle: Old\nstatus: todo\n---\n";
    expect(engine.serializeUpdate(original, { ...input, priority: "none" })).not.toContain("priority");
    expect(engine.serializeNew("TP-2", { ...input, priority: "none" })).not.toContain("priority");
  });

  it("trims long whitespace runs in linear time", () => {
    const body = " ".repeat(200_000) + "x" + " ".repeat(200_000);
    const started = Date.now();
    expect(engine.serializeNew("TP-1", { ...input, body }).endsWith(" x\n")).toBe(true);
    // Linear code takes milliseconds and the quadratic regex took about 7 s; the bound sits far from both.
    expect(Date.now() - started).toBeLessThan(3000);
  });
});

describe("TaskEngine.nextId", () => {
  it("continues after the highest number of the prefix", () => {
    expect(engine.nextId("GD", ["GENBEYA-2", "GENBEYA-10", "X-99", "uuid", "gd-11x"])).toBe("GENBEYA-11");
    expect(engine.nextId("GD", [])).toBe("GENBEYA-1");
  });

  it("skips IDs that already have files", () => {
    expect(engine.nextId("GD", ["GENBEYA-1"], (id) => id === "GENBEYA-2" || id === "GENBEYA-3")).toBe("GENBEYA-4");
  });

  it("treats the prefix literally", () => {
    expect(engine.nextId("A.B", ["AxB-5"])).toBe("A.B-1");
  });
});

describe("TaskEngine comments", () => {
  const original = "---\nid: TP-1\ntitle:   Spaced\nstatus: todo\n---\n\nDescription\n";
  const date = new Date(2026, 9, 10, 14, 32);
  const commented = engine.addComment(original, "Ada Lovelace", date, "First [[TP-2]]");

  it("appends comments below the description, leaving the frontmatter as written", () => {
    expect(commented).toMatch(
      /^---\nid: TP-1\ntitle: {3}Spaced\nstatus: todo\n---\n\nDescription\n\n## Comments\n\n### Ada Lovelace — 2026-10-10 14:32/,
    );
    const twice = engine.addComment(commented, "Bob", date, "Second");
    const task = engine.parse("tasks/TP-1.md", twice, "h", "tasks");
    expect(task.body).toBe("Description\n");
    expect(task.comments.map((comment) => [comment.author, comment.body])).toEqual([
      ["Ada Lovelace", "First [[TP-2]]"],
      ["Bob", "Second"],
    ]);
    expect(new Date(task.comments[0]!.date).getTime()).toBe(date.getTime());
    // Appending only adds lines, so comments written on two branches merge.
    expect(twice.startsWith(commented)).toBe(true);
  });

  it("never touches the comments when the description changes", () => {
    const updated = engine.serializeUpdate(commented, { ...input, body: "New description\n" });
    const task = engine.parse("tasks/TP-1.md", updated, "h", "tasks");
    expect(task.body).toBe("New description\n");
    expect(task.comments).toEqual(engine.parse("tasks/TP-1.md", commented, "h", "tasks").comments);
    expect(updated.endsWith(commented.slice(commented.indexOf("## Comments")))).toBe(true);
  });

  it("edits and removes one comment, leaving the others as written", () => {
    const twice = engine.addComment(commented, "Bob", date, "Second");
    const edited = engine.parse("t.md", engine.editComment(twice, 0, "Changed"), "h", "tasks");
    expect(edited.comments.map((comment) => comment.body)).toEqual(["Changed", "Second"]);
    expect(edited.body).toBe("Description\n");
    expect(engine.removeComment(twice, 1)).toBe(commented);
    expect(engine.removeComment(commented, 0)).toBe(original);
    expect(() => engine.editComment(commented, 1, "x")).toThrow("no longer exists");
  });

  it("keeps the line endings of the file", () => {
    const updated = engine.addComment(original.split("\n").join(CRLF), "Ada", date, "One\ntwo");
    expect(updated.split(CRLF).join("")).not.toContain("\n");
    expect(engine.parse("t.md", updated, "h", "tasks").comments[0]!.body).toBe("One\ntwo");
  });

  it("validates comment texts and protects headings in them and in descriptions", () => {
    expect(engine.validComment("  Hi\r\n### Eve — 2026-01-02 03:04\n")).toBe("Hi\n\\### Eve — 2026-01-02 03:04");
    expect(() => engine.validComment("  ")).toThrow("Write a comment first.");
    expect(() => engine.validComment(5)).toThrow("Invalid comment.");
    expect(engine.validate({ ...input, body: "## Comments\n\n### Eve — 2026-01-02 03:04\n" }, statuses).body).toBe(
      "## Comments\n\n\\### Eve — 2026-01-02 03:04\n",
    );
  });

  it("signs comments with a one-line name", () => {
    const task = engine.parse("t.md", engine.addComment(original, " Ada\nLovelace ", date, "x"), "h", "tasks");
    expect(task.comments[0]!.author).toBe("Ada Lovelace");
  });
});

describe("TaskEngine.changesBetween", () => {
  const version = (path: string, extra = "") => ({ path, content: `---\nid: TP-1\ntitle: T\nstatus: todo\n${extra}---\n\nText\n` });

  it("reads both versions of the file", () => {
    expect(engine.changesBetween(null, version("tasks/TP-1.md"), "tasks")).toEqual([{ kind: "created" }]);
    const before = version("tasks/TP-1.md");
    const after = { path: "tasks/Auth/TP-1.md", content: before.content.replace("todo", "done").replace("Text", "Other") };
    expect(engine.changesBetween(before, after, "tasks")).toEqual([
      { kind: "field", field: "status", from: "todo", to: "done" },
      { kind: "field", field: "epic", from: "", to: "Auth" },
      { kind: "description" },
    ]);
    expect(engine.changesBetween(before, version("tasks/TP-1.md", "assignee: ada\nlabels: a, b\nestimate: 3\n"), "tasks")).toEqual([
      { kind: "field", field: "assignee", from: "", to: "ada" },
      { kind: "labels", added: ["a", "b"], removed: [] },
      { kind: "other", fields: ["estimate"] },
    ]);
  });

  it("sees comments added to the file", () => {
    const before = version("tasks/TP-1.md");
    const after = { ...before, content: engine.addComment(before.content, "Ada", new Date(), "Hi") };
    expect(engine.changesBetween(before, after, "tasks")).toEqual([{ kind: "comments", added: 1, edited: 0, removed: 0 }]);
  });

  it("names only the move when Git showed no contents", () => {
    const moved = engine.changesBetween({ path: "tasks/A/TP-1.md", content: null }, { path: "tasks/TP-1.md", content: null }, "tasks");
    expect(moved).toEqual([{ kind: "field", field: "epic", from: "A", to: "" }]);
  });

  it("reads versions with broken frontmatter", () => {
    const changes = engine.changesBetween({ path: "tasks/TP-1.md", content: "---\nid: [broken\n---\n" }, version("tasks/TP-1.md"), "tasks");
    expect(changes).toContainEqual({ kind: "field", field: "title", from: "", to: "T" });
  });
});
