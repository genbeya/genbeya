import { describe, expect, it } from "vitest";
import type { TaskInput } from "../contracts/model";
import { TaskEngine } from "./task-engine";

const engine = new TaskEngine();
const statuses = ["backlog", "todo", "done"];
const input: TaskInput = {
  title: "Build it",
  status: "backlog",
  priority: "high",
  assignee: "alice",
  labels: ["backend"],
  body: "Useful work.\n\n- [ ] Done\n",
};

describe("TaskEngine.parse", () => {
  it("reads the frontmatter fields and the body", () => {
    const task = engine.parse("tasks/TP-1.md", "---\nid: TP-1\ntitle: One\nstatus: todo\nlabels: [a, b]\n---\n\nBody\n", "h");
    expect(task).toEqual({
      id: "TP-1",
      path: "tasks/TP-1.md",
      title: "One",
      status: "todo",
      priority: "none",
      assignee: "",
      labels: ["a", "b"],
      body: "Body\n",
      hash: "h",
    });
  });

  it("accepts comma-separated labels and CRLF files", () => {
    const task = engine.parse("t.md", "---\r\nid: 7\r\ntitle: T\r\nstatus: done\r\nlabels: a, b\r\n---\r\n", "h");
    expect(task.id).toBe("7");
    expect(task.labels).toEqual(["a", "b"]);
  });

  it.each([
    ["no frontmatter", "Just text\n", "id, title and status"],
    ["missing status", "---\nid: 1\ntitle: T\n---\n", "id, title and status"],
    ["broken YAML", "---\nid: [broken\n---\n", "Invalid YAML frontmatter"],
    ["a list", "---\n- a\n---\n", "YAML mapping"],
  ])("rejects %s", (_, content, message) => {
    expect(() => engine.parse("t.md", content, "h")).toThrow(message);
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
  });

  it.each([
    [{ title: " " }, "needs a title"],
    [{ status: "nope" }, "workflow states"],
    [{ labels: Array.from({ length: 31 }, (_, i) => `l${i}`) }, "at most 30 labels"],
    [{ assignee: 5 }, "Invalid assignee"],
    [{ labels: "a" }, "at most 30 labels"],
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
    const task = engine.parse("tasks/TP-1.md", engine.serializeNew("TP-1", input), "h");
    expect({ ...task, hash: undefined, id: undefined, path: undefined }).toEqual({
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
