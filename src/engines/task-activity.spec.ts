import { describe, expect, it } from "vitest";
import { diffTasks, type TaskState } from "./task-activity";

const state: TaskState = {
  title: "Build it",
  type: "",
  status: "todo",
  priority: "none",
  assignee: "",
  epic: "",
  labels: ["a"],
  description: "Text\n",
  comments: [{ author: "Ada", date: "2026-01-02T03:04", body: "Hi" }],
  fields: { estimate: "3" },
  other: { links: '["a"]' },
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

  it("does not take other line endings for a description edit", () => {
    const before = { ...state, description: "Line one\nLine two\n" };
    expect(diffTasks(before, { ...before, description: "Line one\r\nLine two\r\n" })).toEqual([]);
  });

  it("tells comments written in the same minute apart", () => {
    const second = { author: "Ada", date: "2026-01-02T03:04", body: "Again" };
    expect(diffTasks(state, { ...state, comments: [...state.comments, second] })).toEqual([
      { kind: "comments", added: 1, edited: 0, removed: 0 },
    ]);
    expect(diffTasks({ ...state, comments: [...state.comments, second] }, state)).toEqual([
      { kind: "comments", added: 0, edited: 0, removed: 1 },
    ]);
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

  it("names a changed type with its old and new value", () => {
    expect(diffTasks(state, { ...state, type: "bug" })).toEqual([{ kind: "field", field: "type", from: "", to: "bug" }]);
  });

  it("names changed custom fields with their old and new value, empty where a task had none", () => {
    expect(diffTasks(state, { ...state, fields: { due: "2026-05-01", estimate: "5" } })).toEqual([
      { kind: "custom", field: "due", from: "", to: "2026-05-01" },
      { kind: "custom", field: "estimate", from: "3", to: "5" },
    ]);
    expect(diffTasks(state, { ...state, fields: {} })).toEqual([{ kind: "custom", field: "estimate", from: "3", to: "" }]);
  });

  it("names other changed frontmatter fields", () => {
    expect(diffTasks(state, { ...state, other: { links: '["b"]', meta: "{}" } })).toEqual([{ kind: "other", fields: ["links", "meta"] }]);
  });
});
