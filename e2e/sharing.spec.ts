import type { ElectronApplication, Page } from "@playwright/test";
import type { ElectronBridge } from "../src/contracts/bridges";
import { expect, mainWindow, MOD, test } from "./app";

const LINK = "gitdesk://open?remote=https://github.com/acme/demo.git&task=DP-1";

const clipboard = (app: ElectronApplication) => app.evaluate(({ clipboard }) => clipboard.readText());

async function copyFromTaskMenu(window: Page, entry: string) {
  await window.keyboard.press(`${MOD}+2`);
  await window.locator("gd-task-card", { hasText: "First task" }).click({ button: "right" });
  await window.getByRole("menuitem", { name: entry }).click();
}

test.describe("sharing", () => {
  test.beforeEach(({ repository }) => {
    repository.git("remote", "add", "origin", "https://github.com/acme/demo.git");
  });

  test("copies a task's web link from its context menu", async ({ app, window }) => {
    await copyFromTaskMenu(window, "Copy web link");
    await expect.poll(() => clipboard(app)).toBe("https://github.com/acme/demo/blob/main/tasks/DP-1.md");
  });

  test("opens the context menu from the keyboard", async ({ window }) => {
    await window.keyboard.press(`${MOD}+2`);
    await window.locator("gd-task-card", { hasText: "First task" }).focus();
    await window.keyboard.press("Shift+F10");
    await expect(window.getByRole("menuitem", { name: "Copy GitDesk link" })).toBeFocused();
  });

  test("opens a copied GitDesk link pasted into the palette", async ({ app, window }) => {
    await copyFromTaskMenu(window, "Copy GitDesk link");
    await expect.poll(() => clipboard(app)).toBe(LINK);
    await window.keyboard.press(`${MOD}+1`);
    await window.keyboard.press(`${MOD}+k`);
    await window
      .getByRole("dialog", { name: "Command palette" })
      .getByRole("combobox")
      .fill(await clipboard(app));
    await window.getByRole("option", { name: /Open link/ }).click();
    await expect(window.getByRole("dialog", { name: "Task DP-1" })).toBeVisible();
  });

  test("opens a GitDesk link the app is launched with, in the clone it has seen", async ({ app, window, launch }) => {
    // The first launch shows the repository, so GitDesk knows its remote.
    await expect(window.getByText("Demo Project").first()).toBeVisible();
    await app.close();
    const linked = await mainWindow(await launch(LINK));
    await expect(linked.getByRole("dialog", { name: "Task DP-1" })).toBeVisible();
    // A reloaded page asks for the launch arguments again; it must not open the link again.
    const again = await linked.evaluate(() =>
      (globalThis as unknown as { gitdeskElectron: ElectronBridge }).gitdeskElectron.shell("launchArgs", []),
    );
    expect(again).not.toContain(LINK);
  });
});
