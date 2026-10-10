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
});
