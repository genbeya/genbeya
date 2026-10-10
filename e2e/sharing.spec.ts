import { expect, MOD, test } from "./app";

test.describe("sharing", () => {
  test.beforeEach(({ repository }) => {
    repository.git("remote", "add", "origin", "https://github.com/acme/demo.git");
  });

  test("copies a task's web link from its context menu", async ({ app, window }) => {
    await window.keyboard.press(`${MOD}+2`);
    await window.locator("gd-task-card", { hasText: "First task" }).click({ button: "right" });
    await window.getByRole("menuitem", { name: "Copy web link" }).click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("https://github.com/acme/demo/blob/main/tasks/DP-1.md");
  });

  test("opens the context menu from the keyboard", async ({ window }) => {
    await window.keyboard.press(`${MOD}+2`);
    await window.locator("gd-task-card", { hasText: "First task" }).focus();
    await window.keyboard.press("Shift+F10");
    await expect(window.getByRole("menuitem", { name: "Copy GitDesk link" })).toBeFocused();
  });
});
