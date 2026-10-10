import { task } from "../../testing/fake-platform";
import {
  columnsOf,
  compareTasks,
  displayId,
  epicName,
  labelsOf,
  lanesOf,
  NO_FILTERS,
  peopleOf,
  statusColor,
  titleCase,
  visibleTasks,
} from "./task-model";

const tasks = [
  task("TP-1", { priority: "low", assignee: "ann", labels: ["ui"] }),
  task("TP-2", { priority: "urgent", title: "Fix outage" }),
  task("TP-3", { priority: "low", status: "done", assignee: "bob", labels: ["api", "ui"] }),
  task("TP-4", { status: "blocked", epic: "Billing" }),
  task("TP-5", { status: "todo", epic: "auth/Tokens" }),
];

describe("task ordering and filters", () => {
  it("orders by priority, then newest first", () => {
    expect([...tasks].sort(compareTasks).map((t) => t.id)).toEqual(["TP-2", "TP-3", "TP-1", "TP-5", "TP-4"]);
  });

  it("filters by text, assignee, label and priority", () => {
    expect(visibleTasks(tasks, { ...NO_FILTERS, query: "outage" }).map((t) => t.id)).toEqual(["TP-2"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, assignee: "-" }).map((t) => t.id)).toEqual(["TP-2", "TP-5", "TP-4"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, label: "api" }).map((t) => t.id)).toEqual(["TP-3"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, priority: "low" }).map((t) => t.id)).toEqual(["TP-3", "TP-1"]);
  });

  it("filters by epic, with tasks outside any epic as their own choice", () => {
    expect(visibleTasks(tasks, { ...NO_FILTERS, epic: "Billing" }).map((t) => t.id)).toEqual(["TP-4"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, epic: "" }).map((t) => t.id)).toEqual(["TP-2", "TP-3", "TP-1"]);
  });

  it("shows tasks being moved in their new column and lane", () => {
    const moved = visibleTasks(tasks, NO_FILTERS, new Map([["tasks/TP-1.md", { status: "done", epic: "Billing" }]]));
    expect(moved.find((t) => t.id === "TP-1")).toMatchObject({ status: "done", epic: "Billing" });
  });

  it("makes a swimlane per epic, then one for tasks without an epic", () => {
    expect(lanesOf(tasks)).toEqual(["auth/Tokens", "Billing", ""]);
    expect(epicName("")).toBe("No epic");
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
