import { task } from "../../testing/fake-platform";
import { columnsOf, compareTasks, displayId, labelsOf, NO_FILTERS, peopleOf, statusColor, titleCase, visibleTasks } from "./task-model";

const tasks = [
  task("TP-1", { priority: "low", assignee: "ann", labels: ["ui"] }),
  task("TP-2", { priority: "urgent", title: "Fix outage" }),
  task("TP-3", { priority: "low", status: "done", assignee: "bob", labels: ["api", "ui"] }),
  task("TP-4", { status: "blocked" }),
];

describe("task ordering and filters", () => {
  it("orders by priority, then newest first", () => {
    expect([...tasks].sort(compareTasks).map((t) => t.id)).toEqual(["TP-2", "TP-3", "TP-1", "TP-4"]);
  });

  it("filters by text, assignee, label and priority", () => {
    expect(visibleTasks(tasks, { ...NO_FILTERS, query: "outage" }).map((t) => t.id)).toEqual(["TP-2"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, assignee: "-" }).map((t) => t.id)).toEqual(["TP-2", "TP-4"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, label: "api" }).map((t) => t.id)).toEqual(["TP-3"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, priority: "low" }).map((t) => t.id)).toEqual(["TP-3", "TP-1"]);
  });

  it("shows tasks being moved in their new column", () => {
    const moved = visibleTasks(tasks, NO_FILTERS, new Map([["tasks/TP-1.md", "done"]]));
    expect(moved.find((t) => t.id === "TP-1")?.status).toBe("done");
  });

  it("adds unknown states as extra columns", () => {
    expect(columnsOf(["todo", "done"], tasks)).toEqual(["todo", "done", "blocked"]);
  });

  it("lists people and labels", () => {
    expect(peopleOf(tasks)).toEqual(["ann", "bob"]);
    expect(labelsOf(tasks)).toEqual(["api", "ui"]);
  });
});

describe("task labels", () => {
  it("formats states and IDs", () => {
    expect(titleCase("in-progress")).toBe("In progress");
    expect(displayId("1b4e28ba-2fa1-11d2-883f-0016d3cca427")).toBe("1b4e28ba");
    expect(displayId("GENBEYA-7")).toBe("GENBEYA-7");
  });

  it("colours the first and last states", () => {
    expect(statusColor(0, 4)).toBe("var(--gray)");
    expect(statusColor(3, 4)).toBe("var(--green)");
    expect(statusColor(-1, 4)).toBe("var(--text-3)");
  });
});
