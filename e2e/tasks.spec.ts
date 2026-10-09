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

  test("filters by text", async ({ window }) => {
    await window.getByRole("textbox", { name: "Filter tasks" }).fill("nothing like this");
    await expect(window.getByText("First task")).toBeHidden();
  });
});
