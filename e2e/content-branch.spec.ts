import { expect, MOD, test } from "./app";

test.describe("content branch", () => {
  test("keeps tasks on the content branch and the wiki in the checkout", async ({ window, repository }) => {
    await window.keyboard.press(`${MOD}+,`);
    const tasks = window.getByRole("radiogroup", { name: "Tasks", exact: true });
    await tasks.getByRole("radio", { name: "Content branch" }).click();
    await window.getByRole("dialog").getByRole("button", { name: "Move to the content branch" }).click();
    await expect(tasks.getByRole("radio", { name: "Content branch" })).toHaveAttribute("aria-checked", "true");
    await expect(window.getByRole("radiogroup", { name: "Wiki", exact: true }).getByRole("radio", { name: "Checkout" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(window.getByRole("button", { name: "Sync the content branch" })).toBeVisible();

    await window.keyboard.press(`${MOD}+2`);
    await expect(window.getByRole("region", { name: "Todo" })).toBeVisible();
    await window.keyboard.press("c");
    await window.getByRole("textbox", { name: "Task title" }).fill("Shared task");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByRole("dialog", { name: "Task DP-2" })).toBeVisible();
    await expect.poll(() => repository.git("log", "-1", "--format=%s", "genbeya").trim()).toBe("Create DP-2: Shared task");
    expect(repository.read("tasks/DP-2.md")).toBeNull();
    await window.keyboard.press("Escape");

    await window.keyboard.press(`${MOD}+1`);
    await window.keyboard.press("n");
    const dialog = window.getByRole("dialog", { name: "New page" });
    await dialog.getByRole("textbox").fill("Notes");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect.poll(() => repository.read("docs/Notes.md")).toBe("# Notes\n\n");
    expect(repository.git("status", "--porcelain").trim()).toBe("?? docs/Notes.md");
    expect(repository.git("ls-tree", "-r", "--name-only", "genbeya").trim().split("\n")).toEqual([
      ".genbeya-content",
      "tasks/DP-1.md",
      "tasks/DP-2.md",
    ]);
  });
});
