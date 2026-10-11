import { expect, MOD, test } from "./app";

test.describe("tasks", () => {
  test.beforeEach(async ({ window }) => {
    await window.keyboard.press(`${MOD}+2`);
    await expect(window.getByRole("region", { name: "Todo" })).toBeVisible();
  });

  test("creates a task with C and saves it as a file", async ({ window, repository }) => {
    await window.keyboard.press("c");
    const title = window.getByRole("textbox", { name: "Task title" });
    await expect(title).toBeFocused();
    await title.fill("Second task");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByRole("dialog", { name: "Task DP-2" })).toBeVisible();
    expect(repository.read("tasks/DP-2.md")).toMatch(/id: DP-2\ntitle: Second task\nstatus: backlog/);
  });

  test("asks once before discarding a new task, then takes the next C", async ({ window }) => {
    await window.keyboard.press("c");
    await window.getByRole("textbox", { name: "Task title" }).fill("Half a thought");
    await window.keyboard.press("Escape");
    const ask = window.getByRole("dialog", { name: /^Discard/ });
    await expect(ask).toHaveCount(1);
    await ask.getByRole("button", { name: "Discard changes" }).click();
    await expect(window.getByRole("dialog", { name: "New task" })).toBeHidden();
    await expect(ask).toHaveCount(0);
    await window.keyboard.press("c");
    await expect(window.getByRole("textbox", { name: "Task title" })).toBeFocused();
  });

  test("renders the description, saves checkbox and property changes at once", async ({ window, repository }) => {
    await window.getByText("First task").click();
    const panel = window.getByRole("dialog", { name: "Task DP-1" });
    await panel.getByRole("checkbox").click();
    await expect.poll(() => repository.read("tasks/DP-1.md")).toContain("- [x] Check me");
    await panel.getByRole("button", { name: "Priority" }).click();
    await window.getByRole("menuitem", { name: "Low" }).click();
    await expect.poll(() => repository.read("tasks/DP-1.md")).toContain("priority: low");
    await window.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("edits title and description with E", async ({ window, repository }) => {
    await window.getByText("First task").click();
    await expect(window.getByRole("dialog", { name: "Task DP-1" })).toBeVisible();
    await window.keyboard.press("e");
    const title = window.getByRole("textbox", { name: "Task title" });
    await title.fill("Renamed task");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByRole("dialog", { name: "Task DP-1" }).getByRole("heading", { name: "Renamed task" })).toBeVisible();
    expect(repository.read("tasks/DP-1.md")).toContain("title: Renamed task");
  });

  test("moves a card to another column by dragging", async ({ window, repository }) => {
    const card = window.locator("gd-task-card", { hasText: "First task" });
    // The next column, so it is on screen in small windows too.
    const target = window.getByRole("region", { name: "In progress" });
    const from = (await card.boundingBox())!;
    const to = (await target.boundingBox())!;
    await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await window.mouse.down();
    // The CDK starts dragging after a few pixels of movement.
    await window.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 4 });
    await window.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 12 });
    await window.mouse.up();
    await expect.poll(() => repository.read("tasks/DP-1.md")).toContain("status: in-progress");
    await expect(target.getByText("First task")).toBeVisible();
  });

  test("comments on a task below its description in the file", async ({ window, repository }) => {
    await window.getByText("First task").click();
    const panel = window.getByRole("dialog", { name: "Task DP-1" });
    await panel.getByRole("textbox", { name: "New comment" }).fill("Looks good, see [[Guide]].");
    await window.keyboard.press(`${MOD}+Enter`);
    await expect
      .poll(() => repository.read("tasks/DP-1.md"))
      .toMatch(/- \[ \] Check me\n\n## Comments\n\n### E2E — \d{4}-\d\d-\d\d \d\d:\d\d[+-]\d\d:\d\d\n\nLooks good, see \[\[Guide\]\]\.\n$/);
    const comment = panel.getByRole("article", { name: "Comment by E2E" });
    await expect(comment).toContainText("Looks good, see Guide.");
    await expect(panel.getByRole("textbox", { name: "New comment" })).toHaveValue("");
    await expect(panel.getByRole("tab", { name: "Comments 1" })).toBeVisible();
  });

  test("shows who changed the status once it is committed", async ({ window, repository }) => {
    await window.getByText("First task").click();
    const panel = window.getByRole("dialog", { name: "Task DP-1" });
    await panel.getByRole("button", { name: "Status" }).click();
    await window.getByRole("menuitem", { name: "In progress" }).click();
    await expect.poll(() => repository.read("tasks/DP-1.md")).toContain("status: in-progress");
    await panel.getByRole("tab", { name: "Activity" }).click();
    const pending = panel.locator(".task-activity-entry", { hasText: "Not committed yet" });
    await expect(pending).toContainText("status Todo → In progress");

    repository.git("commit", "-q", "-am", "Start DP-1");
    const committed = panel.locator(".task-activity-entry", { hasText: "Start DP-1" });
    await expect(committed).toContainText("status Todo → In progress");
    await expect(committed).toContainText("E2E");
    await expect(pending).toBeHidden();
    await expect(panel.locator(".task-activity-entry", { hasText: "Initial commit" })).toContainText("created the task");
  });

  test("filters by text", async ({ window }) => {
    await window.getByRole("textbox", { name: "Filter tasks" }).fill("nothing like this");
    await expect(window.getByText("First task")).toBeHidden();
  });
});
