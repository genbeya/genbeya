import { expect, FILES, MOD, test } from "./app";

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

  test("opens a diagram zoomed, with its source beside it or instead of it", async ({ window }) => {
    await window.locator(".document-article").getByRole("img", { name: "PlantUML diagram" }).click();
    const popup = window.getByRole("dialog", { name: "PlantUML diagram" });
    await expect(popup.getByRole("radio", { name: "Diagram" })).toHaveAttribute("aria-checked", "true");
    // The picture has the focus, so the keys zoom it at once.
    const stage = popup.getByRole("img", { name: "PlantUML diagram" });
    await expect(stage).toBeFocused();
    await window.keyboard.press("1");
    await expect(popup.locator(".zoom-level")).toHaveText("100 %");
    await window.keyboard.press("+");
    await expect(popup.locator(".zoom-level")).toHaveText("125 %");
    await popup.getByRole("radio", { name: "Split" }).click();
    await expect(popup.getByRole("textbox", { name: "Source of the PlantUML diagram" })).toContainText("Alice -> Bob: hello");
    await expect(stage).toBeVisible();
    await popup.getByRole("radio", { name: "Source" }).click();
    await expect(stage).toBeHidden();
    await window.keyboard.press("Escape");
    await expect(popup).toBeHidden();
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
    await window.keyboard.type("\nEdited in Genbeya.\n");
    await expect(window.locator(".wiki-preview")).toContainText("Edited in Genbeya.");
    await window.keyboard.press(`${MOD}+s`);
    await expect(window.getByLabel("Unsaved changes")).toBeHidden();
    expect(repository.read("docs/Home.md")).toContain("Edited in Genbeya.");
    await window.keyboard.press("Escape");
    await expect(window.locator(".document-article")).toContainText("Edited in Genbeya.");
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

  test("asks before opening another page with unsaved edits", async ({ window }) => {
    await window.keyboard.press("e");
    await expect(window.getByRole("textbox", { name: "Page source" })).toBeFocused();
    await window.keyboard.type("draft ");
    const guide = window.getByRole("tree", { name: "Pages" }).getByText("Guide", { exact: true });
    await guide.click();
    const dialog = window.getByRole("dialog", { name: "Discard unsaved changes?" });
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(window.getByRole("textbox", { name: "Page source" })).toContainText("draft");
    await guide.click();
    await window.getByRole("dialog").getByRole("button", { name: "Discard changes" }).click();
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
  });

  test("copies the page path to the clipboard", async ({ app, window }) => {
    await window.locator("gd-wiki-page").getByRole("button", { name: "Page actions" }).click();
    await window.getByRole("menuitem", { name: "Copy path" }).click();
    await expect(window.getByText("Path copied")).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe("docs/Home.md");
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

test.describe("moving pages", () => {
  test.use({
    files: {
      ...FILES,
      "docs/Home.md": "# Home\n\nRead the [guide](Guide.md), then [[Guide/Setup]].\n",
      "docs/Guide/Setup.md": "# Setup\n\nBack [home](../Home.md).\n",
    },
  });

  test("updates the links to a moved page and inside it", async ({ window, repository }) => {
    const article = window.locator(".document-article");
    const pages = window.getByRole("tree", { name: "Pages" });
    await pages.getByText("Guide", { exact: true }).click();
    await expect(article.getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
    await window.locator("gd-wiki-page").getByRole("button", { name: "Page actions" }).click();
    await window.getByRole("menuitem", { name: "Move or rename…" }).click();
    const dialog = window.getByRole("dialog", { name: "Move page" });
    await dialog.getByRole("textbox", { name: "New name" }).fill("Manual/Guide");
    const update = dialog.getByRole("checkbox", { name: "Update 3 links in 2 pages" });
    await expect(update).toBeChecked();
    await dialog.getByText("Show links").click();
    await expect(dialog.getByText("docs/Home.md")).toBeVisible();
    await dialog.getByRole("button", { name: "Move" }).click();

    await expect(window).toHaveURL(/page=docs%2FManual%2FGuide\.md/);
    expect(repository.read("docs/Home.md")).toBe("# Home\n\nRead the [guide](Manual/Guide.md), then [[Manual/Guide/Setup]].\n");
    await pages.getByText("Home", { exact: true }).click();
    await article.getByRole("link", { name: "guide" }).click();
    await expect(window).toHaveURL(/page=docs%2FManual%2FGuide\.md/);
    await expect(article.getByRole("heading", { level: 1, name: "Guide" })).toBeVisible();
    await window.keyboard.press("Alt+ArrowLeft");
    await article.getByRole("link", { name: "Setup" }).click();
    await article.getByRole("link", { name: "home" }).click();
    await expect(article.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
  });
});
