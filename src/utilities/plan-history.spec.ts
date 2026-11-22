import { describe, expect, it } from "vitest";
import type { PlanHistory, PlanVersion } from "../contracts/model";
import { baselineComparison, baselineMarkdown, burnChart, burnDown } from "./plan-history";

const statuses = ["todo", "doing", "done"];
const task = (id: string, fields: PlanVersion["fields"], rest: Partial<PlanVersion> = {}): PlanVersion => ({
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
const commit = (hash: string, date: string, author: string, tasks: PlanVersion[]) => ({
  commit: hash,
  date,
  author,
  subject: hash,
  tasks: tasks.map((version) => ({ path: version.path, task: version })),
});

describe("burnDown", () => {
  it("adds up remaining and logged effort day by day, today from the current tasks", () => {
    const history: PlanHistory = {
      commits: [
        commit("c3", "2026-11-03T18:00:00+01:00", "Sam", [task("A", { remaining: "4h" }, { logged: 4 })]),
        commit("c2", "2026-11-03T09:00:00+01:00", "Sam", [task("A", { remaining: "6h" }, { logged: 2 })]),
        commit("c1", "2026-11-01T09:00:00+01:00", "Ada", [
          task("A", { remaining: "8h" }),
          task("B", { remaining: "2h", milestone: "Later" }),
        ]),
      ],
      truncated: false,
      baseline: null,
    };
    const today = [task("A", { remaining: "1h" }, { logged: 7 }), task("B", { remaining: "2h" }, { status: "done" })];
    expect(burnDown(history, today, {}, statuses, "2026-11-05")).toEqual([
      { date: "2026-11-01", remaining: 10, logged: 0 },
      { date: "2026-11-03", remaining: 6, logged: 4 },
      { date: "2026-11-05", remaining: 1, logged: 7 },
    ]);
    expect(burnDown(history, today, { milestone: "Later" }, statuses, "2026-11-05")[0]).toEqual({
      date: "2026-11-01",
      remaining: 2,
      logged: 0,
    });
    expect(burnChart(burnDown(history, today, {}, statuses, "2026-11-05"))).toContain("bar [10, 6, 1]");
    expect(burnChart([])).toBeNull();
  });
});

describe("baselineComparison", () => {
  it("lists what changed since the baseline, with who changed it last", () => {
    const history: PlanHistory = {
      commits: [
        commit("c3", "2026-11-04T09:00:00Z", "Sam", [task("A", { estimate: "16h", due: "2026-11-20" })]),
        commit("c2", "2026-11-02T09:00:00Z", "Ada", [task("A", { estimate: "8h", due: "2026-11-10" })]),
      ],
      truncated: false,
      baseline: {
        revision: "v1",
        commit: "c2",
        date: "2026-11-02T09:00:00Z",
        tasks: [task("A", { estimate: "8h", due: "2026-11-10" }), task("B", { estimate: "4h" })],
      },
    };
    const current = [task("A", { estimate: "16h", due: "2026-11-20", depends_on: ["C"] }), task("C", { estimate: "2h" })];
    const comparison = baselineComparison(history, current, {}, statuses);
    expect(comparison.rows.map((row) => [row.id, row.changes, row.commit?.author ?? null])).toEqual([
      ["A", ["estimate 8h → 16h", "due 2026-11-10 → 2026-11-20", "waits for +C"], "Sam"],
      ["B", ["removed"], null],
      ["C", ["added"], null],
    ]);
    expect(comparison.estimate).toEqual({ before: 12, after: 18 });
    expect(baselineMarkdown(comparison, "v1")).toContain("Estimate 12h at v1, 18h now (+6h)");
  });
});
