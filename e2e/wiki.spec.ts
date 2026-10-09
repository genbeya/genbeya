import { expect, MOD, test } from "./app";

test.describe("wiki", () => {
  test.beforeEach(async ({ window }) => {
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });

  test("opens the home page with its table of contents, links and diagrams", async ({ window }) => {
    const article = window.locator(".document-article");
    await expect(article.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await expect(article.locator(".md-toc").getByRole("link", { name: "Start" })).toHaveAttribute("href", "#start");
    await expect(article.getByRole("link", { name: "DP-1" })).toHaveClass("md-task-ref");
    await expect(article.getByRole("link", { name: "Glossary" })).toHaveClass("md-missing");
    // PlantUML renders locally with rockuml, as an image.
    await expect(article.getByRole("img", { name: "PlantUML diagram" })).toBeVisible();
  });

  test("follows wiki links and goes back with Alt+Left", async ({ window }) => {
    await window.locator(".document-article").getByRole("link", { name: "Guide" }).click();
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
    await window.keyboard.press("Alt+ArrowLeft");
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });

  test("edits a page with E, saves with the shortcut and returns to reading with Escape", async ({ window, repository }) => {
    await window.keyboard.press("e");
    const editor = window.getByRole("textbox", { name: "Page source" });
    await expect(editor).toBeFocused();
    await window.keyboard.press(`${MOD}+End`);
    await window.keyboard.type("\nEdited in GitDesk.\n");
    await expect(window.locator(".wiki-preview")).toContainText("Edited in GitDesk.");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByLabel("Unsaved changes")).toBeHidden();
    expect(repository.read("docs/Home.md")).toContain("Edited in GitDesk.");
    await window.keyboard.press("Escape");
    await expect(window.locator(".document-article")).toContainText("Edited in GitDesk.");
  });

  test("asks before leaving a page with unsaved edits", async ({ window }) => {
    await window.keyboard.press("e");
    await expect(window.getByRole("textbox", { name: "Page source" })).toBeFocused();
    await window.keyboard.press("End");
    await window.keyboard.type(" unsaved");
    await window.getByRole("link", { name: "Tasks" }).click();
    const dialog = window.getByRole("dialog", { name: "Discard unsaved changes?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(window).toHaveURL(/#\/wiki/);
    await window.getByRole("link", { name: "Tasks" }).click();
    await window.getByRole("dialog").getByRole("button", { name: "Discard changes" }).click();
    await expect(window).toHaveURL(/#\/tasks/);
  });

  test("creates a page with N", async ({ window, repository }) => {
    await window.keyboard.press("n");
    const dialog = window.getByRole("dialog", { name: "New page" });
    await dialog.getByRole("textbox").fill("Notes/Meeting");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Meeting" })).toBeVisible();
    expect(repository.read("docs/Notes/Meeting.md")).toBe("# Meeting\n\n");
    await expect(window.getByRole("tree", { name: "Pages" }).getByText("Notes")).toBeVisible();
  });

  test("offers to create pages that links point to", async ({ window, repository }) => {
    await window.locator(".document-article").getByRole("link", { name: "Glossary" }).click();
    const dialog = window.getByRole("dialog", { name: "New page" });
    await expect(dialog.getByRole("textbox")).toHaveValue("Glossary");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect.poll(() => repository.read("docs/Glossary.md")).toBe("# Glossary\n\n");
  });
});
