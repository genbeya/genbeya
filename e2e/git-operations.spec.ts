import { expect, MOD, test } from "./app";

test.describe("stashes, branches, tags, merges and rebases", () => {
  test("stashes changes and pops them back", async ({ window, repository }) => {
    repository.write("src/index.ts", "export const value = 2;\n");
    await window.keyboard.press(`${MOD}+4`);
    await expect(window.locator("gd-change-row", { hasText: "index.ts" })).toBeVisible();
    await window.getByRole("button", { name: "Stash changes" }).click();
    const dialog = window.getByRole("dialog", { name: "Stash changes" });
    await dialog.getByRole("textbox", { name: "Message" }).fill("Half done");
    await dialog.getByRole("button", { name: "Stash", exact: true }).click();
    await expect(window.getByText("Working tree clean")).toBeVisible();
    expect(repository.read("src/index.ts")).toBe("export const value = 1;\n");
    expect(repository.git("stash", "list")).toContain("Half done");

    await window
      .getByRole("region", { name: "Stashes" })
      .getByRole("button", { name: /Half done/ })
      .click();
    await expect(window.locator("gd-stash-pane h2")).toHaveText("Half done");
    await window.locator("gd-stash-pane").getByRole("button", { name: "Pop" }).click();
    await expect(window.locator("gd-change-row", { hasText: "index.ts" })).toBeVisible();
    expect(repository.read("src/index.ts")).toBe("export const value = 2;\n");
    expect(repository.git("stash", "list")).toBe("");
  });

  test("creates and deletes a tag from the history", async ({ window, repository }) => {
    await window.keyboard.press(`${MOD}+5`);
    const row = window.locator(".history-row").first();
    await row.click({ button: "right" });
    await window.getByRole("menuitem", { name: "Create tag here…" }).click();
    const dialog = window.getByRole("dialog", { name: "Create tag" });
    await dialog.getByRole("textbox", { name: "Tag name" }).fill("v1.0");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(row.locator(".ref-tag", { hasText: "v1.0" })).toBeVisible();
    expect(repository.git("tag").trim()).toBe("v1.0");

    await row.click({ button: "right" });
    await window.getByRole("menuitem", { name: "Delete tag v1.0…" }).click();
    await window.getByRole("dialog", { name: "Delete tag" }).getByRole("button", { name: "Delete" }).click();
    await expect(row.locator(".ref-tag")).toHaveCount(0);
    expect(repository.git("tag")).toBe("");
  });
});
