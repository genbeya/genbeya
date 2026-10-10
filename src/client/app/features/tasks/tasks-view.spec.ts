import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../../testing/component-harness";
import { SETTINGS, snapshot, task } from "../../testing/fake-platform";
import { TasksView } from "./tasks-view";

async function render(open?: string) {
  localStorage.setItem("tasks:layout", "list");
  const harness = await openRepository({ tasks: [task("TP-1")] });
  const fixture = TestBed.createComponent(TasksView);
  if (open) fixture.componentRef.setInput("task", open);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const toggle = (state: string) => element.querySelector<HTMLInputElement>(`input[aria-label='Show ${state} on the board']`)!;
  return { ...harness, fixture, element, toggle };
}

/** A save that finishes when `finish` is called. */
function pending() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return { finish, done };
}

describe("TasksView", () => {
  afterEach(() => localStorage.removeItem("tasks:layout"));

  it("saves column choices one after another, each on the newest settings", async () => {
    const { managers, fixture, toggle } = await render();
    const first = pending();
    managers.content.saveSettings.mockReturnValueOnce(first.done).mockResolvedValueOnce(undefined);
    toggle("Backlog").click();
    toggle("Todo").click();
    await settle(fixture);
    expect(managers.content.saveSettings).toHaveBeenCalledTimes(1);
    expect(managers.content.saveSettings).toHaveBeenLastCalledWith("w1", { ...SETTINGS, hiddenColumns: ["backlog"] }, "settings-hash");
    // Both columns are hidden at once, before the saves finish.
    expect(toggle("Todo").checked).toBe(false);

    managers.workspace.snapshot.mockResolvedValueOnce(
      snapshot({ version: "v2", tasks: [task("TP-1")], settings: { ...SETTINGS, hiddenColumns: ["backlog"] }, settingsHash: "h2" }),
    );
    first.finish();
    await vi.waitFor(() => expect(managers.content.saveSettings).toHaveBeenCalledTimes(2));
    expect(managers.content.saveSettings).toHaveBeenLastCalledWith("w1", { ...SETTINGS, hiddenColumns: ["backlog", "todo"] }, "h2");
  });

  it("shows the column again when saving the choice fails", async () => {
    const { managers, fixture, toggle } = await render();
    managers.content.saveSettings.mockRejectedValue(new Error("This file changed on disk."));
    toggle("Backlog").click();
    await settle(fixture);
    expect(managers.content.saveSettings).toHaveBeenCalled();
    expect(toggle("Backlog").checked).toBe(true);
  });

  it("filters by type, showing each task's type icon", async () => {
    localStorage.setItem("tasks:layout", "list");
    await openRepository({ tasks: [task("TP-1", { type: "bug" }), task("TP-2")] });
    const fixture = TestBed.createComponent(TasksView);
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    const rows = () => [...element.querySelectorAll(".task-row")].map((row) => row.querySelector(".task-id")!.textContent);
    expect(element.querySelector(".task-row gd-type-icon[aria-label='Bug']")).not.toBeNull();
    element.querySelector<HTMLButtonElement>("button[aria-label='Filter by']")!.click();
    await settle(fixture);
    const items = [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container [role=menuitem]")];
    items.find((item) => item.textContent!.trim() === "Bug")!.click();
    await settle(fixture);
    expect(rows()).toEqual(["TP-1"]);
    expect(element.querySelector("button[aria-label='Remove filter Bug']")).not.toBeNull();
    document.querySelector(".cdk-overlay-container")?.replaceChildren();
  });

  it("keeps the open task's panel, with its draft, when the task moves to another epic", async () => {
    const { fixture, element, managers, session } = await render("TP-1");
    element.querySelector<HTMLButtonElement>(".task-panel-header .btn-default")!.click();
    await settle(fixture);
    const title = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='Task title']")!;
    title.value = "Draft";
    title.dispatchEvent(new Event("input"));
    managers.workspace.snapshot.mockResolvedValueOnce(
      snapshot({ version: "v2", tasks: [task("TP-1", { path: "tasks/Auth/TP-1.md", epic: "Auth" })] }),
    );
    await session.refresh();
    await settle(fixture);
    expect(element.querySelector("textarea[aria-label='Task title']")).toBe(title);
    expect(title.value).toBe("Draft");
  });
});
