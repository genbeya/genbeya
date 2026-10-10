import { expect, MOD, test } from "./app";

test.describe("terminal", () => {
  test("opens with the shortcut and runs commands in the repository", async ({ window }) => {
    await window.keyboard.press(`${MOD}+Backquote`);
    const panel = window.getByRole("region", { name: "Terminal" });
    await expect(panel.getByRole("tab", { name: "Terminal 1" })).toBeVisible();
    await expect(panel.locator(".xterm-helper-textarea")).toBeFocused();
    await window.keyboard.type("git status");
    await window.keyboard.press("Enter");
    await expect(panel.locator(".xterm-rows")).toContainText("On branch main", { timeout: 20_000 });

    // Hiding keeps the terminal; the shortcut works while it has focus.
    await window.keyboard.press(`${MOD}+Backquote`);
    await expect(panel).toBeHidden();
    await window.keyboard.press(`${MOD}+Backquote`);
    await expect(panel.locator(".xterm-rows")).toContainText("On branch main");
  });

  test("closes a terminal when its shell exits", async ({ window }) => {
    await window.keyboard.press(`${MOD}+Backquote`);
    const panel = window.getByRole("region", { name: "Terminal" });
    await panel.getByRole("button", { name: "New terminal" }).click();
    await expect(panel.getByRole("tab")).toHaveCount(2);
    await expect(panel.locator(".xterm-helper-textarea").last()).toBeFocused();
    await window.keyboard.type("exit");
    await window.keyboard.press("Enter");
    await expect(panel.getByRole("tab")).toHaveCount(1, { timeout: 20_000 });
    await panel.getByRole("button", { name: "Close Terminal 1" }).click();
    await expect(panel).toBeHidden();
  });
});
