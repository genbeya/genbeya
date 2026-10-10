import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../../testing/component-harness";
import { SETTINGS, snapshot, task } from "../../testing/fake-platform";
import { TasksView } from "./tasks-view";

async function render() {
  localStorage.setItem("tasks:layout", "list");
  const harness = await openRepository({ tasks: [task("TP-1")] });
  const fixture = TestBed.createComponent(TasksView);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const toggle = (state: string) => element.querySelector<HTMLInputElement>(`input[aria-label='Show ${state} on the board']`)!;
  return { ...harness, fixture, toggle };
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
});
