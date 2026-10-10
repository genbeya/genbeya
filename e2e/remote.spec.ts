import { execFileSync } from "node:child_process";
import { expect, MOD, test } from "./app";

/** Whether WSL has the Ubuntu distribution, which the backend tests use too. */
function hasUbuntu(): boolean {
  if (process.platform !== "win32") return false;
  try {
    // wsl.exe writes UTF-16LE.
    const names = execFileSync("wsl.exe", ["-l", "-q"]).toString("utf16le").replace(/\0/g, "").split(/\r?\n/);
    return names.some((name) => name.trim() === "Ubuntu");
  } catch {
    return false;
  }
}

test.describe("remote folders", () => {
  test.skip(!hasUbuntu(), "needs the Ubuntu WSL distribution");

  test("browses a WSL distribution for the repository path", async ({ window }) => {
    await window.keyboard.press(`${MOD}+k`);
    await window.getByRole("dialog", { name: "Command palette" }).getByRole("combobox").fill("WSL or SSH");
    await window.keyboard.press("Enter");
    const remote = window.getByRole("dialog", { name: "Open a repository on WSL or SSH" });
    await remote.getByRole("combobox").selectOption("Ubuntu");
    await remote.getByRole("button", { name: "Browse…" }).click();

    // It starts in the home folder, with the list focused for the keyboard.
    const browser = window.getByRole("dialog", { name: "Choose a folder on WSL (Ubuntu)" });
    const path = browser.getByRole("textbox", { name: "Folder path" });
    await expect(path).toHaveValue(/^\/./);
    await expect(browser.getByRole("listbox")).toBeFocused();
    await path.fill("/");
    await path.press("Enter");
    await browser.getByRole("option", { name: "tmp", exact: true }).dblclick();
    await expect(path).toHaveValue("/tmp");
    await browser.getByRole("button", { name: "Select this folder" }).click();

    await expect(browser).toBeHidden();
    await expect(remote.getByRole("textbox", { name: "Repository path" })).toHaveValue("/tmp");
  });
});
