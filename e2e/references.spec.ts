import { expect, FILES, MOD, test } from "./app";

test.use({
  files: {
    ...FILES,
    "docs/Home.md": "# Home\n\nWork on [[DP-1]] per [[Guide]], see [[src/index.ts#L2-L3]].\n\n![[src/index.ts#L2-L3]]\n",
    "src/index.ts": "export const value = 1;\nexport const two = 2;\nexport const three = 3;\n",
  },
});

test.describe("references", () => {
  test("show tasks with their state, pages with their title and files with their lines", async ({ window }) => {
    const article = window.locator(".document-article");
    const task = article.locator("a.md-ref-task");
    await expect(task).toContainText("DP-1");
    await expect(task.locator(".md-ref-title")).toHaveText("First task");
    await expect(task.locator(".md-ref-state")).toHaveText("Todo");
    await expect(article.locator("a.md-ref-page")).toHaveText("Guide");
    await expect(article.locator("a.md-ref-file")).toHaveText("src/index.ts:2–3");
    await expect(article.locator(".md-embed pre")).toHaveText("export const two = 2;\nexport const three = 3;\n");
  });

  test("open a file at the referenced lines", async ({ window }) => {
    await window.locator(".document-article a.md-ref-file").click();
    await expect(window).toHaveURL(/#\/code\?file=src%2Findex.ts&lines=2-3/);
    const editor = window.getByRole("textbox", { name: "Contents of src/index.ts" });
    await expect(editor).toBeVisible();
    await expect.poll(() => window.evaluate(() => getSelection()?.toString())).toBe("export const two = 2;\nexport const three = 3;");
  });

  test("are offered while typing [[ in the editor", async ({ window, repository }) => {
    await expect(window.locator(".document-article").getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    await window.keyboard.press("e");
    const editor = window.getByRole("textbox", { name: "Page source" });
    await expect(editor).toBeFocused();
    await window.keyboard.press(`${MOD}+End`);
    await window.keyboard.type("\nNext: [[First");
    await expect(window.getByRole("option", { name: /DP-1 First task/ })).toBeVisible();
    // CodeMirror ignores keys for a moment after the list opens, so a quick Enter cannot pick by accident.
    await window.waitForTimeout(150);
    await window.keyboard.press("Enter");
    await expect(editor).toContainText("Next: [[DP-1]]");
    await window.keyboard.press(`${MOD}+s`);
    await expect.poll(() => repository.read("docs/Home.md")).toContain("Next: [[DP-1]]");
  });
});
