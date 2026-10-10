import { describe, expect, it } from "vitest";
import { diffTasks, type TaskState } from "./task-activity";

const state: TaskState = {
  title: "Build it",
  status: "todo",
  priority: "none",
  assignee: "",
  epic: "",
  labels: ["a"],
  description: "Text\n",
  comments: [{ author: "Ada", date: "2026-01-02T03:04", body: "Hi" }],
  other: { estimate: "3" },
};

describe("diffTasks", () => {
  it("reports a new task as created, and nothing else", () => {
    expect(diffTasks(null, state)).toEqual([{ kind: "created" }]);
  });

  it("names changed properties with their old and new value", () => {
    expect(diffTasks(state, { ...state, status: "in-progress", assignee: "bob", epic: "Auth", title: "Built" })).toEqual([
      { kind: "field", field: "title", from: "Build it", to: "Built" },
      { kind: "field", field: "status", from: "todo", to: "in-progress" },
      { kind: "field", field: "assignee", from: "", to: "bob" },
      { kind: "field", field: "epic", from: "", to: "Auth" },
    ]);
  });

  it("lists added and removed labels", () => {
    expect(diffTasks(state, { ...state, labels: ["b", "c"] })).toEqual([{ kind: "labels", added: ["b", "c"], removed: ["a"] }]);
  });

  it("notices description edits, but not whitespace at its ends", () => {
    expect(diffTasks(state, { ...state, description: "Text\n\n" })).toEqual([]);
    expect(diffTasks(state, { ...state, description: "Other\n" })).toEqual([{ kind: "description" }]);
  });

  it("counts added, edited and removed comments", () => {
    const second = { author: "Bob", date: "2026-01-03T03:04", body: "Yo" };
    expect(diffTasks(state, { ...state, comments: [...state.comments, second] })).toEqual([
      { kind: "comments", added: 1, edited: 0, removed: 0 },
    ]);
    expect(diffTasks(state, { ...state, comments: [{ ...state.comments[0]!, body: "Hello" }, second] })).toEqual([
      { kind: "comments", added: 1, edited: 1, removed: 0 },
    ]);
    expect(diffTasks(state, { ...state, comments: [] })).toEqual([{ kind: "comments", added: 0, edited: 0, removed: 1 }]);
  });

  it("names other changed frontmatter fields", () => {
    expect(diffTasks(state, { ...state, other: { estimate: "5", type: '"bug"' } })).toEqual([
      { kind: "other", fields: ["estimate", "type"] },
    ]);
  });
});
