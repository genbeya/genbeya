import { describe, expect, it } from "vitest";
import type { Task } from "../../contracts/model";
import { groupTasks, withStatus } from "./task-groups";

const task = (id: string, status: string): Task => ({
  id,
  path: `tasks/${id}.md`,
  title: `Task ${id}`,
  status,
  priority: "high",
  assignee: "alice",
  labels: ["ui"],
  type: "bug",
  fields: { estimate: 3 },
  body: "Fix it.",
  epic: "",
  hash: "abc",
  comments: [],
});

const settings = { statuses: ["todo", "doing", "done"], hiddenColumns: [] };

describe("groupTasks", () => {
  it("groups by state in the settings' order, empty states included", () => {
    const groups = groupTasks([task("T-1", "done"), task("T-2", "todo")], settings);
    expect(groups.map((group) => [group.status, group.tasks.map((t) => t.id)])).toEqual([
      ["todo", ["T-2"]],
      ["doing", []],
      ["done", ["T-1"]],
    ]);
  });

  it("orders tasks by the number of their ID", () => {
    const groups = groupTasks([task("T-10", "todo"), task("T-9", "todo"), task("T-100", "todo")], settings);
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual(["T-9", "T-10", "T-100"]);
  });

  it("keeps tasks whose state is not configured, after the configured ones", () => {
    const groups = groupTasks([task("T-1", "blocked")], settings);
    expect(groups.map((group) => group.status)).toEqual(["todo", "doing", "done", "blocked"]);
    expect(groups[3]!.tasks).toHaveLength(1);
  });

  it("collapses the last state and hidden columns", () => {
    const groups = groupTasks([], { statuses: ["backlog", "todo", "done"], hiddenColumns: ["backlog"] });
    expect(groups.map((group) => group.collapsed)).toEqual([true, false, true]);
  });
});

describe("withStatus", () => {
  it("changes only the state", () => {
    const { status, ...rest } = withStatus(task("T-1", "todo"), "done");
    expect(status).toBe("done");
    expect(rest).toEqual({
      title: "Task T-1",
      priority: "high",
      assignee: "alice",
      labels: ["ui"],
      body: "Fix it.",
      epic: "",
      type: "bug",
      fields: { estimate: 3 },
    });
  });
});
