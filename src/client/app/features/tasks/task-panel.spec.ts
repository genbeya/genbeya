import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../../testing/component-harness";
import type { TaskInput } from "../../../../contracts/model";
import { UnsavedChanges } from "../../core/unsaved-changes";
import { SETTINGS, task } from "../../testing/fake-platform";
import { FIELD_DELAY, TaskPanel } from "./task-panel";

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

  it("shows the effort, and logs time last in the time log, signed with the Git name", async () => {
    const logged = task("TP-2", {
      fields: { estimate: "16h", remaining: "6h", depends_on: ["TP-1"] },
      body: "Body.\n\n## Time log\n\n- 2026-10-21 — Alex — 2h — Started\n",
    });
    const { managers, dialogs } = await openRepository({
      tasks: [first, logged],
      settings: {
        ...SETTINGS,
        fields: [
          { name: "estimate", type: "effort" },
          { name: "remaining", type: "effort" },
        ],
      },
    });
    const fixture = TestBed.createComponent(TaskPanel);
    fixture.componentRef.setInput("task", logged);
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    const items = [...element.querySelectorAll(".task-effort-item")];
    const text = (item: Element, part: string) => item.querySelector(`.task-effort-${part}`)!.textContent!.trim();
    expect(items.map((item) => `${text(item, "label")} ${text(item, "value")}`)).toEqual([
      "Estimate 16h",
      "Logged 2h",
      "Remaining 6h",
      "Forecast 8h",
      "Variance −8h",
    ]);
    expect(element.querySelector(".task-relations")?.textContent).toContain("Blocked by");
    dialogs.prompt.mockResolvedValue("1.5h Reviewed it");
    managers.content.commentAuthor.mockResolvedValue("Ada");
    managers.content.updateTask.mockResolvedValue({ ...logged, hash: "h2" });
    [...element.querySelectorAll("button")].find((button) => button.textContent!.includes("Log time"))!.click();
    await vi.waitFor(() => expect(managers.content.updateTask).toHaveBeenCalled());
    const body = (managers.content.updateTask.mock.calls[0]![2] as TaskInput).body;
    expect(body).toMatch(/- 2026-10-21 — Alex — 2h — Started\n- \d{4}-\d{2}-\d{2} — Ada — 1.5h — Reviewed it\n$/);
  });

  it("takes focus when it opens a task", async () => {
    const { fixture } = await render({ task: first });
    expect(document.activeElement).toBe(fixture.nativeElement);
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

  it("offers the configured types in the type menu and saves the choice", async () => {
    const { button, managers, fixture } = await render({ task: first });
    managers.content.updateTask.mockResolvedValue({ ...first, type: "bug", hash: "h2" });
    expect(button("Type").textContent).toContain("No type");
    button("Type").click();
    await settle(fixture);
    const items = [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container [role=menuitem]")];
    expect(items.map((item) => item.textContent!.replace(/\s+/g, " ").trim())).toEqual(["No type (selected)", "Bug", "Feature"]);
    items[1]!.click();
    await vi.waitFor(() =>
      expect(managers.content.updateTask).toHaveBeenCalledWith(
        "w1",
        "tasks/TP-1.md",
        expect.objectContaining({ type: "bug" }),
        "hash-TP-1",
      ),
    );
    document.querySelector(".cdk-overlay-container")?.replaceChildren();
  });

  it("takes back a template's presets for a type without one, keeping what the user changed", async () => {
    const { managers, fixture } = await render({ createStatus: "todo" });
    managers.content.taskTemplate.mockImplementation(async (_: string, type: string) =>
      type === "bug" ? { body: "## Steps\n", priority: "high", labels: ["bug"], fields: { area: "ui", severity: "major" } } : null,
    );
    const panel = fixture.componentInstance as unknown as {
      patch(change: object): void;
      setField(change: object): void;
      draft(): TaskInput;
    };
    panel.patch({ type: "bug" });
    await settle(fixture);
    panel.patch({ priority: "low" });
    panel.setField({ name: "area", value: "backend" });
    panel.patch({ type: "chore" });
    await settle(fixture);
    expect(panel.draft()).toMatchObject({ type: "chore", body: "", priority: "low", labels: [], fields: { area: "backend" } });
  });

  it("starts a new task of a type from the type's template, keeping a description written already", async () => {
    const { managers, fixture, element } = await render({ createStatus: "todo" });
    managers.content.taskTemplate.mockImplementation(async (_: string, type: string) =>
      type === "bug" ? { body: "## Steps\n", priority: "high", labels: ["bug"] } : { body: "## Goal\n" },
    );
    const panel = fixture.componentInstance as unknown as { patch(change: object): void; draft(): TaskInput };
    panel.patch({ type: "bug" });
    await settle(fixture);
    expect(managers.content.taskTemplate).toHaveBeenCalledWith("w1", "bug");
    expect(panel.draft()).toMatchObject({ type: "bug", body: "## Steps\n", priority: "high", labels: ["bug"] });
    // Another type replaces what the first template put in: its description and presets.
    panel.patch({ type: "feature" });
    await settle(fixture);
    expect(panel.draft()).toMatchObject({ body: "## Goal\n", priority: "none", labels: [] });
    // A description written by hand stays; presets fill what is still unset.
    panel.patch({ body: "Mine" });
    panel.patch({ type: "bug" });
    await settle(fixture);
    expect(panel.draft()).toMatchObject({ body: "Mine", priority: "high", labels: ["bug"] });
    expect(element.querySelector("button[aria-label='Type']")!.textContent).toContain("Bug");
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

  it("asks only once before closing with an unsent comment, leaving nothing for the route to ask about", async () => {
    const { element, dialogs, fixture, router } = await render({ task: first });
    const unsaved = TestBed.inject(UnsavedChanges);
    const navigate = vi.spyOn(router, "navigate").mockImplementation(async () => !unsaved.any());
    const composer = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='New comment']")!;
    composer.value = "Unsent";
    composer.dispatchEvent(new Event("input"));
    await settle(fixture);
    expect(unsaved.any()).toBe(true);
    element.querySelector<HTMLButtonElement>("button[aria-label='Close (Esc)']")!.click();
    await settle(fixture);
    expect(dialogs.discardEdits).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(["/tasks"]);
    expect(await navigate.mock.results[0]!.value).toBe(true);
  });

  it("asks once before cancelling a new task with a title, leaving nothing for the route to ask about", async () => {
    const { element, dialogs, fixture, router, button } = await render({ createStatus: "todo" });
    const unsaved = TestBed.inject(UnsavedChanges);
    const navigate = vi.spyOn(router, "navigate").mockImplementation(async () => !unsaved.any());
    const title = element.querySelector<HTMLTextAreaElement>("textarea[aria-label='Task title']")!;
    title.value = "Half a thought";
    title.dispatchEvent(new Event("input"));
    await settle(fixture);
    button("Cancel").click();
    await settle(fixture);
    expect(dialogs.discardEdits).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(["/tasks"]);
    expect(await navigate.mock.results[0]!.value).toBe(true);
  });

  it("keeps an unsent comment while the task is edited", async () => {
    const { element, fixture, button } = await render({ task: first });
    const composer = () => element.querySelector<HTMLTextAreaElement>("textarea[aria-label='New comment']")!;
    composer().value = "Unsent";
    composer().dispatchEvent(new Event("input"));
    button("Edit").click();
    await settle(fixture);
    expect(element.querySelector(".task-discussion")!.classList).toContain("is-hidden");
    button("Cancel").click();
    await settle(fixture);
    expect(element.querySelector(".task-discussion")!.classList).not.toContain("is-hidden");
    expect(composer().value).toBe("Unsent");
  });

  it("moves between comments and activity with the arrow keys", async () => {
    const { element, managers, fixture } = await render({ task: first });
    managers.content.taskActivity.mockResolvedValue([]);
    const tabs = [...element.querySelectorAll<HTMLButtonElement>("[role=tab]")];
    expect(tabs.map((tab) => element.querySelector(`#${tab.getAttribute("aria-controls")}`)!.getAttribute("role"))).toEqual([
      "tabpanel",
      "tabpanel",
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1]);
    tabs[0]!.focus();
    tabs[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle(fixture);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0]);
    tabs[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await settle(fixture);
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
  });

  it("saves field changes once they rest, together, keeping each field changed meanwhile", async () => {
    const { managers, fixture } = await render({ task: { ...first, fields: { due: "2026-01-01" } } });
    vi.useFakeTimers();
    onTestFinished(() => void vi.useRealTimers());
    managers.content.updateTask
      .mockResolvedValueOnce({ ...first, fields: { due: "2026-12-24", estimate: 5 }, hash: "h2" })
      .mockResolvedValueOnce({ ...first, fields: { due: "2026-12-24", estimate: 5, area: "ui" }, hash: "h3" });
    const panel = fixture.componentInstance as unknown as { setField(change: object): void; shown(): TaskInput };
    // A date typed digit by digit, and an estimate, before anything is saved.
    panel.setField({ name: "due", value: "2026-12-02" });
    panel.setField({ name: "due", value: "2026-12-24" });
    panel.setField({ name: "estimate", value: 5 });
    expect(panel.shown().fields).toEqual({ due: "2026-12-24", estimate: 5 });
    expect(managers.content.updateTask).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(FIELD_DELAY);
    expect(managers.content.updateTask).toHaveBeenCalledTimes(1);
    expect(managers.content.updateTask.mock.calls[0]!.slice(2)).toEqual([
      expect.objectContaining({ fields: { due: "2026-12-24", estimate: 5 } }),
      "hash-TP-1",
    ]);
    // Another field changed while that saves goes on the newest version, with both.
    panel.setField({ name: "area", value: "ui" });
    await vi.advanceTimersByTimeAsync(FIELD_DELAY);
    expect(managers.content.updateTask.mock.calls[1]!.slice(2)).toEqual([
      expect.objectContaining({ fields: { due: "2026-12-24", estimate: 5, area: "ui" } }),
      "h2",
    ]);
  });

  it("saves a field change still resting when the panel closes", async () => {
    const { managers, fixture } = await render({ task: first });
    managers.content.updateTask.mockResolvedValue({ ...first, fields: { estimate: 5 }, hash: "h2" });
    (fixture.componentInstance as unknown as { setField(change: object): void }).setField({ name: "estimate", value: 5 });
    fixture.destroy();
    await vi.waitFor(() => expect(managers.content.updateTask).toHaveBeenCalledTimes(1));
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
