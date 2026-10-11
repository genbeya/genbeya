import type { ElementContent } from "hast";
import { lineRanges, parseCodeMeta, splitLines } from "./code-blocks";
import { renderMarkdownTree } from "./markdown-dom";
import { parseMarkdown } from "./markdown-pipeline";

function render(markdown: string) {
  const container = document.createElement("div");
  container.append(renderMarkdownTree(parseMarkdown(markdown), document, { path: "docs/A.md", interactiveCheckboxes: false }).fragment);
  return container;
}

const lines = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(".md-line")].map((line) => [line.textContent, line.className, line.dataset["line"] ?? null]);

describe("code block meta", () => {
  it("reads titles, line numbers and marked lines as Docusaurus writes them", () => {
    expect(parseCodeMeta('title="src/app.ts" {2,4-6} showLineNumbers')).toEqual({
      title: "src/app.ts",
      firstLine: 1,
      marked: [
        [2, 2],
        [4, 6],
      ],
      added: [],
      removed: [],
    });
    expect(parseCodeMeta("filename=app.ts showLineNumbers=10 ins={3} del={1-2}")).toEqual({
      title: "app.ts",
      firstLine: 10,
      marked: [],
      added: [[3, 3]],
      removed: [[1, 2]],
    });
    expect(parseCodeMeta(undefined)).toEqual({ title: null, firstLine: null, marked: [], added: [], removed: [] });
    expect(parseCodeMeta("title='a b' showLineNumbersX").title).toBe("a b");
    expect(parseCodeMeta("showLineNumbersX").firstLine).toBeNull();
  });

  it("skips malformed and reversed ranges", () => {
    expect(lineRanges("1, x, 5-3, 0, 7 - 8,")).toEqual([
      [1, 1],
      [7, 8],
    ]);
  });

  it("splits highlighted code into lines, keeping the spans each line is in", () => {
    const code: ElementContent[] = [
      { type: "element", tagName: "span", properties: { className: ["c"] }, children: [{ type: "text", value: "/* a\nb */" }] },
      { type: "text", value: " x\ny" },
    ];
    expect(splitLines(code)).toEqual([
      [{ type: "element", tagName: "span", properties: { className: ["c"] }, children: [{ type: "text", value: "/* a" }] }],
      [
        { type: "element", tagName: "span", properties: { className: ["c"] }, children: [{ type: "text", value: "b */" }] },
        { type: "text", value: " x" },
      ],
      [{ type: "text", value: "y" }],
    ]);
  });
});

describe("code blocks", () => {
  it("shows the title, numbers lines and marks the chosen ones", () => {
    const container = render('```ts title="src/app.ts" {2} showLineNumbers=5\nconst a = 1;\nconst b = 2;\n```');
    expect(container.querySelector(".md-code-title")?.textContent).toBe("src/app.ts");
    expect(container.querySelector(".md-code-language")?.textContent).toBe("ts");
    expect(container.querySelector(".md-code")?.classList.contains("has-line-numbers")).toBe(true);
    expect(lines(container)).toEqual([
      ["const a = 1;\n", "md-line", "5"],
      ["const b = 2;", "md-line is-marked", "6"],
    ]);
    expect(container.querySelector(".md-line .hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector("pre")?.textContent).toBe("const a = 1;\nconst b = 2;");
  });

  it("reads ranges stuck to the language", () => {
    expect(lines(render("```js{1}\nx\n```"))).toEqual([["x", "md-line is-marked", null]]);
  });

  it("leaves plain blocks as they were", () => {
    const container = render("```ts\nconst a = 1;\n```");
    expect(container.querySelector(".md-line")).toBeNull();
    expect(container.querySelector(".md-code-title")).toBeNull();
  });

  it("colours added and removed lines of diffs", () => {
    expect(lines(render("```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n same\n```"))).toEqual([
      ["--- a/x\n", "md-line", null],
      ["+++ b/x\n", "md-line", null],
      ["@@ -1 +1 @@\n", "md-line", null],
      ["-old\n", "md-line is-removed", null],
      ["+new\n", "md-line is-added", null],
      [" same", "md-line", null],
    ]);
  });

  it("highlights diff-ts as TypeScript, with the signs in a column of their own", () => {
    const container = render("```diff-ts\n-const a = 1;\n+const a = 2;\n```");
    expect(lines(container)).toEqual([
      ["-const a = 1;\n", "md-line is-removed", null],
      ["+const a = 2;", "md-line is-added", null],
    ]);
    expect(container.querySelector(".md-line > .md-diff-sign")?.textContent).toBe("-");
    expect(container.querySelector(".md-line .hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector<HTMLElement>("[aria-label='Copy code']")?.dataset["copy"]).toBe("-const a = 1;\n+const a = 2;");
  });

  it("offers to wrap long lines", () => {
    const wrap = render("```\nx\n```").querySelector<HTMLElement>("[aria-label='Wrap lines']");
    expect(wrap?.dataset["wrap"]).toBe("");
    expect(wrap?.getAttribute("aria-pressed")).toBe("false");
  });

  it("never turns a title into markup", () => {
    const container = render('```ts title="<img src=x onerror=alert(1)>"\nx\n```');
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector(".md-code-title")?.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
