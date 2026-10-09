import { expect, MOD, test } from "./app";

test.describe("code, changes and history", () => {
  test("edits a file, commits it, and shows the commit in the history", async ({ window, repository }) => {
    await window.keyboard.press(`${MOD}+3`);
    await window.getByRole("tree", { name: "Files" }).getByText("src").click();
    await window.getByRole("tree", { name: "Files" }).getByText("index.ts").click();
    const editor = window.getByRole("textbox", { name: "Contents of src/index.ts" });
    await editor.click();
    await window.keyboard.press(`${MOD}+End`);
    await window.keyboard.type("export const other = 2;\n");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByLabel("Unsaved changes")).toBeHidden();
    expect(repository.read("src/index.ts")).toContain("other = 2");

    await window.keyboard.press(`${MOD}+4`);
    await expect(window.locator("gd-change-row", { hasText: "index.ts" })).toBeVisible();
    await expect(window.locator("gd-diff-view")).toBeVisible();
    await window.getByRole("textbox", { name: "Commit message" }).fill("Add another value");
    await window.keyboard.press(`${MOD}+Enter`);
    await expect(window.getByText("Working tree clean")).toBeVisible();
    expect(repository.git("log", "-1", "--format=%s").trim()).toBe("Add another value");

    await window.keyboard.press(`${MOD}+5`);
    await expect(window.locator(".history-row").first()).toContainText("Add another value");
    await expect(window.locator(".commit-head h2")).toHaveText("Add another value");
  });

  test("stages and unstages single files", async ({ window, repository }) => {
    repository.write("notes.txt", "new");
    await window.keyboard.press(`${MOD}+4`);
    const row = window.locator("gd-change-row", { hasText: "notes.txt" });
    await row.hover();
    await row.getByRole("button", { name: "Stage" }).click();
    await expect(window.getByRole("region", { name: "Staged changes" }).locator("gd-change-row", { hasText: "notes.txt" })).toBeVisible();
    expect(repository.git("status", "--porcelain")).toContain("A  notes.txt");
  });
});
