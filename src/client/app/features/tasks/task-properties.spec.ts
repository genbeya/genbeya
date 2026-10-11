import { TestBed } from "@angular/core/testing";
import type { TaskInput } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { task } from "../../testing/fake-platform";
import { inputOf } from "./task-model";
import { TaskProperties } from "./task-properties";

const ada = { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: [], commits: 1 };

describe("TaskProperties", () => {
  afterEach(() => document.querySelector(".cdk-overlay-container")?.replaceChildren());

  it("offers the repository's people as assignees, by name, and assigns them by handle", async () => {
    const harness = await openRepository({ tasks: [task("TP-1", { assignee: "Ada Lovelace" }), task("TP-2", { assignee: "sam" })] });
    harness.managers.content.people.mockResolvedValue({ people: [ada], me: null });
    const fixture = TestBed.createComponent(TaskProperties);
    fixture.componentRef.setInput("value", inputOf(task("TP-1", { assignee: "Ada Lovelace" })));
    const changes: Partial<TaskInput>[] = [];
    fixture.componentInstance.changed.subscribe((change) => changes.push(change));
    await settle(fixture);
    const button = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>("button[aria-label='Assignee']")!;
    expect(button.querySelector("gd-avatar")!.getAttribute("title")).toBe("Ada Lovelace");
    expect(button.textContent).toContain("Ada Lovelace");
    button.click();
    await settle(fixture);
    const items = [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container [role=menuitem]")];
    const text = (item: HTMLElement, part: string) => item.querySelector(part)?.textContent!.replace(/\s+/g, " ").trim();
    expect(items.map((item) => [text(item, ".grow"), text(item, ".menu-hint")])).toEqual([
      ["Unassigned", undefined],
      ["Ada Lovelace (selected)", "@ada"],
      ["sam", undefined],
      ["Someone else…", undefined],
    ]);
    items[2]!.click();
    expect(changes).toEqual([{ assignee: "sam" }]);
  });
});
