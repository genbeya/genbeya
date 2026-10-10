import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../../testing/component-harness";
import { task } from "../../testing/fake-platform";
import { TaskPanel } from "./task-panel";

const first = task("TP-1", { title: "First task", priority: "high", body: "- [ ] one\n- [ ] two\n" });

async function render(input: { task?: typeof first; createStatus?: string }) {
  const harness = await openRepository({ tasks: [first] });
  const fixture = TestBed.createComponent(TaskPanel);
  if (input.task) fixture.componentRef.setInput("task", input.task);
  if (input.createStatus) fixture.componentRef.setInput("createStatus", input.createStatus);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...element.querySelectorAll("button")].find((b) => b.textContent!.trim().startsWith(name) || b.getAttribute("aria-label") === name)!;
  return { ...harness, fixture, element, button };
}

describe("TaskPanel", () => {
  it("shows the task with its rendered description", async () => {
    const { element } = await render({ task: first });
    expect(element.querySelector("h1")!.textContent).toBe("First task");
    expect(element.querySelectorAll(".md-check.is-interactive")).toHaveLength(2);
  });

  it("saves checkbox clicks in order, each on the newest version", async () => {
    const { element, managers, fixture } = await render({ task: first });
    managers.content.updateTask
      .mockResolvedValueOnce({ ...first, body: "- [x] one\n- [ ] two\n", hash: "h2" })
      .mockResolvedValueOnce({ ...first, body: "- [x] one\n- [x] two\n", hash: "h3" });
    const boxes = element.querySelectorAll<HTMLElement>(".md-check.is-interactive");
    boxes[0]!.click();
    boxes[1]!.click();
    await vi.waitFor(() => expect(managers.content.updateTask).toHaveBeenCalledTimes(2));
    await settle(fixture);
    const [firstCall, secondCall] = managers.content.updateTask.mock.calls;
    expect(firstCall!.slice(1)).toEqual(["tasks/TP-1.md", expect.objectContaining({ body: "- [x] one\n- [ ] two\n" }), "hash-TP-1"]);
    expect(secondCall!.slice(1)).toEqual(["tasks/TP-1.md", expect.objectContaining({ body: "- [x] one\n- [x] two\n" }), "h2"]);
  });

  it("saves edits against the version the edit started from", async () => {
    const { button, managers, fixture, element } = await render({ task: first });
    managers.content.updateTask.mockResolvedValue({ ...first, title: "Renamed", hash: "h2" });
    button("Edit").click();
    await settle(fixture);
    const title = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='Task title']")!;
    title.value = "Renamed";
    title.dispatchEvent(new Event("input"));
    // The task changes on disk while editing; the save must not overwrite that.
    fixture.componentRef.setInput("task", { ...first, hash: "newer" });
    await settle(fixture);
    button("Save").click();
    await settle(fixture);
    expect(managers.content.updateTask).toHaveBeenCalledWith(
      "w1",
      "tasks/TP-1.md",
      expect.objectContaining({ title: "Renamed" }),
      "hash-TP-1",
    );
    expect(element.querySelector("h1")!.textContent).toBe("Renamed");
  });

  it("saves an edit where the task moved meanwhile, keeping its new epic", async () => {
    const { button, managers, fixture, element } = await render({ task: first });
    const moved = { ...first, path: "tasks/Auth/TP-1.md", epic: "Auth" };
    managers.content.updateTask.mockResolvedValue({ ...moved, title: "Renamed", hash: "h2" });
    button("Edit").click();
    await settle(fixture);
    const title = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='Task title']")!;
    title.value = "Renamed";
    title.dispatchEvent(new Event("input"));
    // Another window moves the task to an epic; its file keeps its content.
    fixture.componentRef.setInput("task", moved);
    await settle(fixture);
    button("Save").click();
    await settle(fixture);
    expect(managers.content.updateTask).toHaveBeenCalledWith(
      "w1",
      "tasks/Auth/TP-1.md",
      expect.objectContaining({ title: "Renamed", epic: "Auth" }),
      "hash-TP-1",
    );
  });

  it("asks before discarding an edited task", async () => {
    const { button, fixture, element, dialogs } = await render({ task: first });
    button("Edit").click();
    await settle(fixture);
    const title = element.querySelector<HTMLTextAreaElement>("textarea")!;
    title.value = "Changed";
    title.dispatchEvent(new Event("input"));
    dialogs.discardEdits.mockResolvedValue(false);
    button("Cancel").click();
    await settle(fixture);
    expect(dialogs.discardEdits).toHaveBeenCalledWith("this task");
    expect(element.querySelector("textarea")).not.toBeNull();
  });

  it("creates tasks and refuses empty titles", async () => {
    const { button, fixture, element, managers, router } = await render({ createStatus: "todo" });
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    button("Create task").click();
    await settle(fixture);
    expect(managers.content.createTask).not.toHaveBeenCalled();

    managers.content.createTask.mockResolvedValue(task("TP-2"));
    const title = element.querySelector<HTMLTextAreaElement>("textarea")!;
    title.value = "Second";
    title.dispatchEvent(new Event("input"));
    button("Create task").click();
    await settle(fixture);
    expect(managers.content.createTask).toHaveBeenCalledWith("w1", expect.objectContaining({ title: "Second", status: "todo" }));
    expect(navigate).toHaveBeenCalledWith(["/tasks"], { queryParams: { task: "TP-2" }, replaceUrl: true });
  });

  it("shows comments below the description and loads the activity only when asked", async () => {
    const { element, managers, fixture } = await render({ task: first });
    managers.content.taskActivity.mockResolvedValue([]);
    expect(element.querySelector("textarea[aria-label='New comment']")).not.toBeNull();
    expect(managers.content.taskActivity).not.toHaveBeenCalled();
    const activity = [...element.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((tab) => tab.textContent!.trim() === "Activity")!;
    activity.click();
    await settle(fixture);
    expect(managers.content.taskActivity).toHaveBeenCalledWith("w1", "tasks/TP-1.md");
    expect(activity.getAttribute("aria-selected")).toBe("true");
  });

  it("shows a commented task as saved at once", async () => {
    const { element, managers, fixture } = await render({ task: first });
    managers.content.addComment.mockResolvedValue({
      ...first,
      hash: "h2",
      comments: [{ author: "Ada", date: "2026-10-10T14:32+02:00", body: "Done" }],
    });
    const composer = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='New comment']")!;
    composer.value = "Done";
    composer.dispatchEvent(new Event("input"));
    await settle(fixture);
    element.querySelector<HTMLButtonElement>(".task-composer button")!.click();
    await settle(fixture);
    expect(element.querySelector(".task-comment")!.textContent).toContain("Done");
    expect(element.querySelector("[role=tab]")!.textContent).toContain("1");
  });

  it("asks before closing with an unsent comment", async () => {
    const { element, dialogs, fixture, router } = await render({ task: first });
    const navigate = vi.spyOn(router, "navigate").mockResolvedValue(true);
    const composer = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='New comment']")!;
    composer.value = "Unsent";
    composer.dispatchEvent(new Event("input"));
    dialogs.discardEdits.mockResolvedValue(false);
    element.querySelector<HTMLButtonElement>("button[aria-label='Close (Esc)']")!.click();
    await settle(fixture);
    expect(dialogs.discardEdits).toHaveBeenCalledWith("this comment");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("changes properties at once while viewing", async () => {
    const { managers, fixture } = await render({ task: first });
    managers.content.updateTask.mockResolvedValue({ ...first, priority: "low", hash: "h2" });
    (fixture.componentInstance as unknown as { patch(change: object): void }).patch({ priority: "low" });
    await vi.waitFor(() =>
      expect(managers.content.updateTask).toHaveBeenCalledWith(
        "w1",
        "tasks/TP-1.md",
        expect.objectContaining({ priority: "low", title: "First task" }),
        "hash-TP-1",
      ),
    );
  });
});
