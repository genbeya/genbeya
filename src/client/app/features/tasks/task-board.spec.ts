import { TestBed } from "@angular/core/testing";
import { openRepository } from "../../testing/component-harness";
import { SETTINGS, task } from "../../testing/fake-platform";
import { TaskBoard } from "./task-board";
import type { Placement } from "./task-model";

async function render(columns: readonly string[]) {
  await openRepository();
  const fixture = TestBed.createComponent(TaskBoard);
  fixture.componentRef.setInput("columns", columns);
  fixture.componentRef.setInput("statuses", SETTINGS.statuses);
  fixture.componentRef.setInput("tasks", [task("TP-1", { epic: "Auth" })]);
  fixture.componentRef.setInput("lanes", ["Auth", ""]);
  const created: Placement[] = [];
  fixture.componentInstance.create.subscribe((placement) => created.push(placement));
  await fixture.whenStable();
  const button = (name: string) => (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  return { button, created };
}

describe("TaskBoard", () => {
  it("starts a task in a swimlane in the lane's first column", async () => {
    // The board hides the first state, Backlog.
    const { button, created } = await render(["todo", "done"]);
    button("New task in Auth").click();
    button("New task in No epic").click();
    expect(created).toEqual([
      { status: "todo", epic: "Auth" },
      { status: "todo", epic: "" },
    ]);
  });

  it("starts a task in a column in that column's state", async () => {
    const { button, created } = await render(["todo", "done"]);
    button("New task in Done").click();
    expect(created).toEqual([{ status: "done", epic: "" }]);
  });
});
