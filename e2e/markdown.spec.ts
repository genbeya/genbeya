import { expect, FILES, test } from "./app";

/** A page with the Markdown engineering docs use, long enough to scroll to its footnotes. */
const ENGINEERING_PAGE = [
  "# Engineering",
  "",
  "Mass and energy: $E = mc^2$, for prices $5 and $10 stay text.",
  "",
  "$$",
  "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
  "$$",
  "",
  '```ts title="src/app.ts" {2} showLineNumbers',
  "const a = 1;",
  "const b = a + 1;",
  "```",
  "",
  "> [!TIP]- Folded tip",
  "> Hidden until opened.",
  "",
  "Press <kbd>Ctrl</kbd>+<kbd>S</kbd> to save.[^1]",
  "",
  ...Array.from({ length: 30 }, (_, index) => `Paragraph ${index + 1}.\n`),
  "[^1]: Or use the menu.",
  "",
].join("\n");

test.describe("Markdown for engineering docs", () => {
  test.use({ files: { ...FILES, "docs/Home.md": ENGINEERING_PAGE } });

  test("typesets inline and block math without errors", async ({ window }) => {
    const errors: string[] = [];
    window.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const article = window.locator(".document-article");
    await expect(article.getByRole("heading", { level: 1, name: "Engineering" })).toBeVisible();
    await expect(article.locator("p .md-math math")).toHaveCount(1);
    await expect(article.locator(".md-math.is-display math[display='block'] mfrac")).toBeVisible();
    await expect(article.locator("p").first()).toContainText("prices $5 and $10 stay text");
    // The formula is laid out as math, not as a line of text.
    expect(await article.locator(".md-math.is-display math").evaluate((math) => math.getBoundingClientRect().height)).toBeGreaterThan(30);
    expect(errors).toEqual([]);
  });

  test("copies a titled code block with its marked line", async ({ app, window }) => {
    const code = window.locator(".document-article .md-code");
    await expect(code.locator(".md-code-title")).toHaveText("src/app.ts");
    await expect(code.locator(".md-line.is-marked")).toHaveText("const b = a + 1;");
    await expect(code.locator(".md-line").first()).toHaveAttribute("data-line", "1");
    await code.getByRole("button", { name: "Copy code" }).click();
    await expect
      .poll(async () => (await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, "\n"))
      .toBe("const a = 1;\nconst b = a + 1;");
  });

  test("opens a folded callout", async ({ window }) => {
    const callout = window.locator(".document-article details.callout");
    await expect(callout.getByText("Hidden until opened.")).toBeHidden();
    await callout.getByText("Folded tip").click();
    await expect(callout.getByText("Hidden until opened.")).toBeVisible();
  });

  test("shows keys, previews a footnote and links back from it", async ({ window }) => {
    const article = window.locator(".document-article");
    await expect(article.locator("kbd")).toHaveText(["Ctrl", "S"]);
    const reference = article.locator("a[data-footnote-ref]");
    await reference.hover();
    await expect(window.locator(".md-footnote-preview")).toHaveText("Or use the menu.");
    const note = article.locator("section.footnotes li");
    await expect(note).not.toBeInViewport();
    await reference.click();
    await expect(note).toBeInViewport();
    await note.locator("a[data-footnote-backref]").click();
    await expect(reference).toBeInViewport();
  });
});
