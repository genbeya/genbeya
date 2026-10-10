import { expect, FILES, MOD, test } from "./app";

test.use({
  files: {
    ...FILES,
    "tasks/Login rework/DP-2.md": "---\nid: DP-2\ntitle: Token refresh\nstatus: todo\n---\n",
  },
});

test.describe("board columns and epics", () => {
  test.beforeEach(async ({ window }) => {
    await window.keyboard.press(`${MOD}+2`);
    await expect(window.getByRole("region", { name: "Todo" })).toBeVisible();
  });

  test("hides a column from the board for the whole team, from the list", async ({ window, repository }) => {
    await window.getByRole("radio", { name: "List" }).click();
    const backlog = window.getByRole("checkbox", { name: "Show Backlog on the board" });
    await expect(backlog).toBeChecked();
    await backlog.uncheck();
    await expect.poll(() => repository.read(".gitdesk.yml")).toContain("hiddenColumns:\n  - backlog");
    await window.getByRole("radio", { name: "Board" }).click();
    await expect(window.getByRole("region", { name: "Todo" })).toBeVisible();
    await expect(window.getByRole("region", { name: "Backlog" })).toHaveCount(0);
    await window.getByRole("radio", { name: "List" }).click();
    await window.getByRole("checkbox", { name: "Show Backlog on the board" }).check();
    await expect.poll(() => repository.read(".gitdesk.yml")).not.toContain("hiddenColumns");
  });

  test("shows epics as swimlanes and moves a card into another epic by dragging", async ({ window, repository }) => {
    await window.getByRole("button", { name: "Swimlanes by epic" }).click();
    const lane = window.getByRole("group", { name: "Login rework" });
    await expect(lane.getByText("Token refresh")).toBeVisible();
    const card = window.getByRole("group", { name: "No epic" }).locator("gd-task-card", { hasText: "First task" });
    const target = lane.getByRole("region", { name: "Todo in Login rework" });
    const from = (await card.boundingBox())!;
    const to = (await target.boundingBox())!;
    await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await window.mouse.down();
    await window.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 10, { steps: 4 });
    await window.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await window.mouse.up();
    await expect.poll(() => repository.read("tasks/Login rework/DP-1.md")).toContain("title: First task");
    expect(repository.read("tasks/DP-1.md")).toBeNull();
    await expect(lane.getByText("First task")).toBeVisible();
  });

  test("moves a task into a new epic from its panel", async ({ window, repository }) => {
    await window.getByText("First task").click();
    const panel = window.getByRole("dialog", { name: "Task DP-1" });
    await panel.getByRole("button", { name: "Epic" }).click();
    await window.getByRole("menuitem", { name: "New epic…" }).click();
    const dialog = window.getByRole("dialog", { name: "New epic" });
    await dialog.getByRole("textbox").fill("Billing");
    await dialog.getByRole("button", { name: "Move here" }).click();
    await expect.poll(() => repository.read("tasks/Billing/DP-1.md")).toContain("title: First task");
    await expect(panel.getByRole("button", { name: "Epic" })).toHaveText("Billing");
  });
});
