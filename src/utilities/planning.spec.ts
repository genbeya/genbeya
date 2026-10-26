import { describe, expect, it } from "vitest";
import {
  addTimeEntry,
  dependenciesOf,
  dependencyChart,
  dependsOn,
  effortOf,
  formatEffort,
  formatVariance,
  matchesFilter,
  parseEffort,
  parseFilter,
  timeLogOf,
  timeline,
  type PlanTask,
} from "./planning";

const statuses = ["backlog", "todo", "in-progress", "done"];
const task = (id: string, fields: PlanTask["fields"] = {}, rest: Partial<PlanTask> = {}): PlanTask => ({
  id,
  path: `tasks/${id}.md`,
  title: `Task ${id}`,
  status: "todo",
  epic: "",
  assignee: "",
  labels: [],
  type: "",
  fields,
  logged: 0,
  unreadable: 0,
  ...rest,
});

describe("effort", () => {
  it("reads hours, days and plain numbers", () => {
    expect([parseEffort("16h"), parseEffort("2d"), parseEffort(" 1.5 H "), parseEffort(3), parseEffort("6")]).toEqual([16, 16, 1.5, 3, 6]);
    expect([parseEffort("soon"), parseEffort("-2h"), parseEffort(undefined), parseEffort(true), parseEffort(["2h"])]).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("writes hours and signed differences", () => {
    expect([formatEffort(12.5), formatEffort(1 / 3), formatVariance(2), formatVariance(-3.5), formatVariance(0)]).toEqual([
      "12.5h",
      "0.33h",
      "+2h",
      "−3.5h",
      "0h",
    ]);
  });

  it("forecasts logged + remaining against the estimate", () => {
    const fields = { estimate: "16h", remaining: "6h" };
    expect(effortOf({ fields, logged: 6.5 }, false)).toEqual({ estimate: 16, logged: 6.5, remaining: 6, forecast: 12.5, variance: -3.5 });
    // Remaining is never derived from the estimate; a finished task needs none.
    expect(effortOf({ fields: { estimate: "16h" }, logged: 4 }, false)).toEqual({
      estimate: 16,
      logged: 4,
      remaining: null,
      forecast: null,
      variance: null,
    });
    expect(effortOf({ fields: { estimate: "2d" }, logged: 20 }, true)).toMatchObject({ remaining: 0, forecast: 20, variance: 4 });
  });
});

describe("the time log", () => {
  const body = [
    "Add token validation.",
    "",
    "## Time log",
    "",
    "- 2026-10-21 — Alex — 2h — Investigated OAuth flow",
    "- 2026-10-22 – Alex – 3h",
    "* 2026-10-23 - Jean-Luc Picard - 0.5d - Tests - and more",
    "- yesterday, a while",
    "",
    "```",
    "- 2026-10-24 — Not — 9h",
    "```",
    "",
    "## Notes",
    "",
    "- 2026-10-25 — Outside — 9h",
  ].join("\n");

  it("reads the entries of the section, and flags list items it can't read", () => {
    expect(timeLogOf(body)).toEqual({
      entries: [
        { date: "2026-10-21", author: "Alex", hours: 2, note: "Investigated OAuth flow" },
        { date: "2026-10-22", author: "Alex", hours: 3, note: "" },
        { date: "2026-10-23", author: "Jean-Luc Picard", hours: 4, note: "Tests - and more" },
      ],
      unreadable: ["- yesterday, a while"],
      total: 9,
    });
    expect(timeLogOf("No log.\n\n- 2026-10-21 — Alex — 2h")).toEqual({ entries: [], unreadable: [], total: 0 });
  });

  it("adds entries last in the section, starting one when there is none", () => {
    const entry = { date: "2026-10-26", author: "Sam\nX", hours: 1.5, note: "Reviewed\nit" };
    const added = addTimeEntry(body, entry).split("\n");
    expect(added[added.indexOf("```") - 2]).toBe("- 2026-10-26 — Sam X — 1.5h — Reviewed it");
    expect(timeLogOf(addTimeEntry(body, entry)).total).toBe(10.5);
    expect(addTimeEntry("Description.\n\n", { ...entry, note: "" })).toBe("Description.\n\n## Time log\n\n- 2026-10-26 — Sam X — 1.5h\n");
    expect(addTimeEntry("", { ...entry, note: "" })).toBe("## Time log\n\n- 2026-10-26 — Sam X — 1.5h\n");
    expect(addTimeEntry("A\r\n\r\n## Time log\r\n", { ...entry, note: "" })).toBe(
      "A\r\n\r\n## Time log\r\n\r\n- 2026-10-26 — Sam X — 1.5h\r\n",
    );
  });
});

describe("dependencies", () => {
  it("reads lists and IDs separated by commas or spaces", () => {
    expect(dependsOn({ depends_on: ["tp-1", "TP-2", "TP-1"] })).toEqual(["TP-1", "TP-2"]);
    expect(dependsOn({ depends_on: "TP-1, TP-2 TP-3" })).toEqual(["TP-1", "TP-2", "TP-3"]);
    expect(dependsOn({})).toEqual([]);
  });

  it("knows what each task waits for and blocks, and whether it is blocked or ready", () => {
    const tasks = [
      task("TP-1", {}, { status: "done" }),
      task("TP-2", { depends_on: ["TP-1"] }),
      task("TP-3", { depends_on: ["TP-1", "TP-2"] }),
      task("TP-4", { depends_on: ["TP-3"] }, { status: "done" }),
    ];
    const { waitsFor, blocks, states, problems } = dependenciesOf(tasks, statuses);
    expect(Object.fromEntries(waitsFor)).toEqual({ "TP-2": ["TP-1"], "TP-3": ["TP-1", "TP-2"], "TP-4": ["TP-3"] });
    expect(Object.fromEntries(blocks)).toEqual({ "TP-1": ["TP-2", "TP-3"], "TP-2": ["TP-3"], "TP-3": ["TP-4"] });
    expect(Object.fromEntries(states)).toEqual({ "TP-2": "ready", "TP-3": "blocked", "TP-4": "done" });
    expect(problems.size).toBe(0);
  });

  it("names unknown tasks, a task depending on itself, and cycles", () => {
    const tasks = [
      task("TP-1", { depends_on: ["TP-1", "TP-9", "TP-2"] }),
      task("TP-2", { depends_on: "TP-3" }),
      task("TP-3", { depends_on: "TP-1" }),
    ];
    expect(Object.fromEntries(dependenciesOf(tasks, statuses).problems)).toEqual({
      "TP-1": ["depends on itself", "depends on TP-9, which doesn't exist", "is part of a cycle: TP-1 → TP-2 → TP-3 → TP-1"],
      "TP-2": ["is part of a cycle: TP-1 → TP-2 → TP-3 → TP-1"],
      "TP-3": ["is part of a cycle: TP-1 → TP-2 → TP-3 → TP-1"],
    });
  });
});

describe("plan macros", () => {
  it("reads filters, quoted or not, and leaves unknown keys out", () => {
    expect(parseFilter(' epic="2 Planning" milestone=MVP color=red Label=ui')).toEqual({
      epic: "2 Planning",
      milestone: "MVP",
      label: "ui",
    });
  });

  it("matches epics with the epics inside them, milestones, labels and properties", () => {
    const one = task("TP-1", { milestone: "MVP" }, { epic: "Auth/Tokens", labels: ["ui"], assignee: "alex" });
    expect(matchesFilter(one, { epic: "auth" })).toBe(true);
    expect(matchesFilter(one, { epic: "Au" })).toBe(false);
    expect(matchesFilter(one, { milestone: "mvp", label: "UI", assignee: "Alex" })).toBe(true);
    expect(matchesFilter(one, { status: "done" })).toBe(false);
  });

  it("draws dependencies from blocker to blocked, with the tasks waited for", () => {
    const tasks = [task("TP-1", {}, { status: "done", title: 'Say "hi": <b>' }), task("TP-2", { depends_on: ["TP-1"] }), task("TP-3")];
    const dependencies = dependenciesOf(tasks, statuses);
    expect(dependencyChart([tasks[1]!], tasks, dependencies, statuses)?.split("\n").slice(0, 4)).toEqual([
      "flowchart LR",
      '  t0["TP-2 Task TP-2"]:::ready',
      `  t1["TP-1 Say 'hi' 'b'"]:::done`,
      "  t1 --> t0",
    ]);
    expect(dependencyChart([tasks[2]!], tasks, dependencies, statuses)).toBeNull();
  });

  it("puts dated tasks on a timeline by epic, and marks those that start before what they wait for is due", () => {
    const tasks = [
      task("TP-1", { start: "2026-11-02", due: "2026-11-10" }, { status: "done", epic: "Auth" }),
      task("TP-2", { start: "2026-11-05", due: "2026-11-12", depends_on: ["TP-1"] }, { epic: "Auth" }),
      task("TP-3", { due: "2026-11-20" }),
      task("TP-4", { start: "2026-11-01" }),
    ];
    const result = timeline(tasks, tasks, dependenciesOf(tasks, statuses), statuses);
    expect(result.chart?.split("\n")).toEqual([
      "gantt",
      "  dateFormat YYYY-MM-DD",
      "  axisFormat %d %b",
      "  section Auth",
      "  TP-1 Task TP-1 :done, t0, 2026-11-02, 2026-11-10",
      "  TP-2 Task TP-2 :crit, t1, 2026-11-05, 2026-11-12",
      "  section No epic",
      "  TP-3 Task TP-3 :milestone, t2, 2026-11-20, 0d",
    ]);
    expect(result).toMatchObject({ undated: 1, conflicts: ["TP-2"] });
    expect(timeline([tasks[3]!], tasks, dependenciesOf(tasks, statuses), statuses)).toEqual({ chart: null, undated: 1, conflicts: [] });
  });
});
