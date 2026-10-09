import { expect, MOD, test } from "./app";

test.describe("shell", () => {
  test("names the window after the project", async ({ app, window }) => {
    await expect(window.getByText("Demo Project").first()).toBeVisible();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getTitle())).toBe("Demo Project — GitDesk");
  });

  test("searches pages, tasks and files from the palette", async ({ window }) => {
    await window.keyboard.press(`${MOD}+k`);
    const palette = window.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("guide");
    await window.keyboard.press("Enter");
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
  });

  test("creates and switches branches from the branch palette", async ({ window, repository }) => {
    await window.getByRole("button", { name: "Switch branch" }).click();
    await window.getByRole("option", { name: "Create branch…" }).click();
    const dialog = window.getByRole("dialog", { name: "Create branch" });
    await dialog.getByRole("textbox").fill("feature/e2e");
    await dialog.getByRole("button", { name: "Create and switch" }).click();
    await expect(window.getByRole("button", { name: "Switch branch" })).toContainText("feature/e2e");
    expect(repository.git("branch", "--show-current").trim()).toBe("feature/e2e");
  });

  test("saves project settings to .gitdesk.yml", async ({ window, repository }) => {
    await window.keyboard.press(`${MOD}+,`);
    await window.getByLabel("Name", { exact: true }).fill("Renamed Project");
    await window.getByRole("button", { name: /Save changes/ }).click();
    await expect.poll(() => repository.read(".gitdesk.yml")).toContain("name: Renamed Project");
    await expect(window.locator(".workspace-name")).toHaveText("Renamed Project");
  });

  test("switches the theme", async ({ window }) => {
    await window.keyboard.press(`${MOD}+,`);
    await window.getByRole("radio", { name: "Light" }).click();
    await expect(window.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("shows the keyboard shortcuts with ?", async ({ window }) => {
    await window.keyboard.press("Shift+?");
    await expect(window.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });
});
