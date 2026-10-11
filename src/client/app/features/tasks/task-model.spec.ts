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
  toneColor,
  typeLook,
  typesOf,
  visibleTasks,
} from "./task-model";

const tasks = [
  task("TP-1", { priority: "low", assignee: "ann", labels: ["ui"] }),
  task("TP-2", { priority: "urgent", title: "Fix outage" }),
  task("TP-3", { priority: "low", status: "done", assignee: "bob", labels: ["api", "ui"] }),
  task("TP-4", { status: "blocked", epic: "Billing" }),
  task("TP-5", { status: "todo", epic: "auth/Tokens", type: "bug" }),
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

  it("filters by type, with tasks without one as their own choice", () => {
    expect(visibleTasks(tasks, { ...NO_FILTERS, type: "bug" }).map((t) => t.id)).toEqual(["TP-5"]);
    expect(visibleTasks(tasks, { ...NO_FILTERS, type: "" }).map((t) => t.id)).toEqual(["TP-2", "TP-3", "TP-1", "TP-4"]);
  });

  it("lists the configured types, then other types tasks have", () => {
    const bug = { name: "bug", icon: "bug", tone: "red" } as const;
    expect(typesOf([bug, { name: "chore", icon: "wrench" }], [...tasks, task("TP-6", { type: "spike" })])).toEqual([
      bug,
      { name: "chore", icon: "wrench" },
      { name: "spike", icon: "circle-dot" },
    ]);
    expect(typeLook("bug", [bug])).toBe(bug);
    expect(typeLook("spike", [bug])).toEqual({ name: "spike", icon: "circle-dot" });
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

  it("filters and lists assignees as people, however the tasks write them", () => {
    const written = [task("TP-7", { assignee: "Ann Smith" }), task("TP-8", { assignee: "ANN" }), ...tasks];
    const identify = (assignee: string) => (["ann", "ann smith"].includes(assignee.toLowerCase()) ? "ann" : assignee);
    expect(visibleTasks(written, { ...NO_FILTERS, assignee: "ann" }, new Map(), identify).map((t) => t.id)).toEqual([
      "TP-1",
      "TP-8",
      "TP-7",
    ]);
    expect(peopleOf(written, identify)).toEqual(["ann", "bob"]);
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

  it("colours types by their tone", () => {
    expect(toneColor("red")).toBe("var(--red)");
    expect(toneColor(undefined)).toBe("var(--text-2)");
  });
});
