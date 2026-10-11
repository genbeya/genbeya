import { expect, FILES, MOD, test } from "./app";

test.describe("task types, fields and state icons", () => {
  test.use({
    files: {
      ...FILES,
      ".gitdesk.yml": `${FILES[".gitdesk.yml"]}fields:\n  - name: estimate\n    type: number\n`,
      "tasks/.templates/bug.md": "---\npriority: high\n---\n\n## Steps to reproduce\n",
    },
  });

  test.beforeEach(async ({ window }) => {
    await window.keyboard.press(`${MOD}+2`);
    await expect(window.getByRole("region", { name: "Todo" })).toBeVisible();
  });

  test("creates a bug from the bug template and shows its icon on the board", async ({ window, repository }) => {
    await window.keyboard.press("c");
    await window.getByRole("textbox", { name: "Task title" }).fill("Crash on save");
    await window.getByRole("button", { name: "Type" }).click();
    await window.getByRole("menuitem", { name: "Bug" }).click();
    const panel = window.getByRole("dialog", { name: "New task" });
    await expect(panel.locator(".cm-content")).toContainText("## Steps to reproduce");
    await expect(panel.getByRole("button", { name: "Priority" })).toContainText("High");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByRole("dialog", { name: "Task DP-2" })).toBeVisible();
    expect(repository.read("tasks/DP-2.md")).toBe(
      "---\nid: DP-2\ntitle: Crash on save\ntype: bug\nstatus: backlog\npriority: high\n---\n\n## Steps to reproduce\n",
    );
    await window.keyboard.press("Escape");
    const card = window.locator("gd-task-card", { hasText: "Crash on save" });
    await expect(card.getByRole("img", { name: "Bug" })).toBeVisible();
    // The template is no task, and its folder no epic.
    await expect(window.getByText("Steps to reproduce")).toBeHidden();
    await expect(window.getByRole("button", { name: "Swimlanes by epic" })).toBeHidden();
  });

  test("edits a custom field in the panel and writes it to the file", async ({ window, repository }) => {
    await window.getByText("First task").click();
    const estimate = window.getByRole("dialog", { name: "Task DP-1" }).getByLabel("Estimate");
    await estimate.fill("5");
    await estimate.press("Tab");
    await expect.poll(() => repository.read("tasks/DP-1.md")).toContain("priority: high\nestimate: 5\n");
  });

  test("changes a column icon in settings", async ({ window, repository }) => {
    await window.keyboard.press(`${MOD}+,`);
    await window.getByRole("button", { name: "Icon of Done" }).click();
    await window.getByRole("menuitemradio", { name: "Flag" }).click();
    await window.getByRole("button", { name: /Save changes/ }).click();
    await expect.poll(() => repository.read(".gitdesk.yml")).toContain("  - name: done\n    icon: flag\n");
    // The save is done once the form is clean again.
    await expect(window.getByRole("button", { name: /Save changes/ })).toBeHidden();
    await window.keyboard.press(`${MOD}+2`);
    await expect(window.getByRole("region", { name: "Done" }).locator(".board-column-header svg.lucide-flag")).toBeVisible();
  });
});
