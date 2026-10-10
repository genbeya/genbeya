import { TestBed } from "@angular/core/testing";
import type { TaskActivity as Activity } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { task } from "../../testing/fake-platform";
import { describeChange, TaskActivity } from "./task-activity";

const first = task("TP-1");
const entries: Activity[] = [
  { commit: null, author: "Ada", date: null, subject: "", changes: [{ kind: "comments", added: 1, edited: 0, removed: 0 }] },
  {
    commit: "a".repeat(40),
    author: "Bob",
    date: "2026-10-10T14:32:00+02:00",
    subject: "Start TP-1",
    changes: [
      { kind: "field", field: "status", from: "todo", to: "in-progress" },
      { kind: "field", field: "epic", from: "", to: "Auth" },
    ],
  },
];

async function render() {
  const harness = await openRepository({ tasks: [first] });
  harness.managers.content.taskActivity.mockResolvedValue(entries);
  const fixture = TestBed.createComponent(TaskActivity);
  fixture.componentRef.setInput("task", first);
  await settle(fixture);
  return { ...harness, fixture, element: fixture.nativeElement as HTMLElement };
}

describe("TaskActivity", () => {
  it("lists who changed the task and how, with edits not committed yet first", async () => {
    const { element } = await render();
    const items = [...element.querySelectorAll(".task-activity-entry")];
    expect(items.map((item) => item.querySelector(".task-activity-author")!.textContent)).toEqual(["Ada", "Bob"]);
    expect(items[0]!.textContent).toContain("Not committed yet");
    expect(items[0]!.textContent).toContain("added a comment");
    expect(items[1]!.textContent).toContain("status Todo → In progress");
    expect(items[1]!.textContent).toContain("epic No epic → Auth");
    expect(items[1]!.textContent).toContain("Start TP-1");
    expect(items[1]!.querySelector("time")!.getAttribute("title")).toBe(new Date("2026-10-10T14:32:00+02:00").toLocaleString());
  });

  it("loads again when the task or the commit changes", async () => {
    const { fixture, managers, session } = await render();
    expect(managers.content.taskActivity).toHaveBeenCalledWith("w1", "tasks/TP-1.md");
    fixture.componentRef.setInput("task", { ...first, hash: "h2" });
    await settle(fixture);
    expect(managers.content.taskActivity).toHaveBeenCalledTimes(2);
    managers.workspace.snapshot.mockResolvedValue({
      ...session.snapshot()!,
      version: "v2",
      head: { ...session.snapshot()!.head, commit: "def5678" },
    });
    await session.refresh();
    await settle(fixture);
    expect(managers.content.taskActivity).toHaveBeenCalledTimes(3);
  });

  it("says when there is nothing to show, and why loading failed", async () => {
    const { fixture, managers, element } = await render();
    managers.content.taskActivity.mockResolvedValue([]);
    fixture.componentRef.setInput("task", { ...first, hash: "h2" });
    await settle(fixture);
    expect(element.textContent).toContain("No changes recorded yet.");
    managers.content.taskActivity.mockRejectedValue(new Error("git broke"));
    fixture.componentRef.setInput("task", { ...first, hash: "h3" });
    await settle(fixture);
    expect(element.textContent).toContain("git broke");
  });
});

describe("describeChange", () => {
  it.each([
    [{ kind: "created" }, "created the task"],
    [{ kind: "field", field: "title", from: "Old", to: "New" }, "title “Old” → “New”"],
    [{ kind: "field", field: "assignee", from: "", to: "ada" }, "assignee nobody → ada"],
    [{ kind: "field", field: "priority", from: "high", to: "none" }, "priority High → None"],
    [{ kind: "field", field: "type", from: "bug", to: "feature" }, "type Bug → Feature"],
    [{ kind: "field", field: "type", from: "", to: "bug" }, "type none → Bug"],
    [{ kind: "custom", field: "estimate", from: "3", to: "5" }, "estimate 3 → 5"],
    [{ kind: "custom", field: "due", from: "", to: "2026-05-01" }, "due none → 2026-05-01"],
    [{ kind: "labels", added: ["a", "b"], removed: ["c"] }, "labels +a +b −c"],
    [{ kind: "description" }, "edited the description"],
    [{ kind: "comments", added: 2, edited: 1, removed: 1 }, "added 2 comments, edited a comment, deleted a comment"],
    [{ kind: "other", fields: ["links", "meta"] }, "changed links, meta"],
  ] as const)("%j", (change, text) => {
    expect(describeChange(change)).toBe(text);
  });
});
