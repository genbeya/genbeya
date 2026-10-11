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

test.describe("task references in a table", () => {
  test.use({
    files: {
      ...FILES,
      "docs/Home.md":
        "# Home\n\nSee [[DP-2]].\n\n| Task | Owner | Notes | Due |\n| --- | --- | --- | --- |\n| [[DP-2]] | Ann | Waiting for the vendor's answer about the new contract terms | Friday afternoon |\n",
      "tasks/DP-2.md": "---\nid: DP-2\ntitle: Migrate the billing service to the new payment provider\nstatus: todo\n---\n",
    },
  });

  test("wrap in narrow cells instead of cutting the title short, and stay on one line in text", async ({ window }) => {
    const article = window.locator(".document-article");
    const titles = article.locator("a.md-ref-task .md-ref-title");
    await expect(titles).toHaveCount(2);
    expect(await titles.nth(1).evaluate((title) => title.scrollWidth > title.clientWidth)).toBe(false);
    const lines = (chip: HTMLElement) => Math.round(chip.getBoundingClientRect().height / parseFloat(getComputedStyle(chip).lineHeight));
    expect(await article.locator(".md-table a.md-ref-task").evaluate(lines)).toBeGreaterThan(1);
    expect(await article.locator("p a.md-ref-task").evaluate(lines)).toBe(1);
  });
});
