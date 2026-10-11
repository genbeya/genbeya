import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";
import { renderMarkdownTree } from "./markdown-dom";
import { parseMarkdown } from "./markdown-pipeline";
import { remarkMath } from "./math";

/** The formulas of `markdown`: inline as `$…$`, blocks as `$$…$$`. */
function formulas(markdown: string): string[] {
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
  const tree = processor.runSync(processor.parse(markdown), markdown) as Root;
  const found: string[] = [];
  visit(tree, (node) => {
    if (node.type === "inlineMath") found.push(`$${node.value}$`);
    if (node.type === "math") found.push(`$$${node.value}$$`);
  });
  return found;
}

describe("math syntax", () => {
  it("reads $…$ in text", () => {
    expect(formulas("Euler: $e^{i\\pi} + 1 = 0$, and $x$.")).toEqual(["$e^{i\\pi} + 1 = 0$", "$x$"]);
  });

  it.each([
    "It costs $5 and $10.",
    "Between $20,000 and $30,000.",
    "US$5 or US$10",
    "A lone $ sign",
    "$ x$",
    "$x $",
    "$x$5",
    "Escaped \\$x\\$",
    "In code: `$x$`",
  ])("leaves %s as text", (markdown) => {
    expect(formulas(markdown)).toEqual([]);
  });

  it("closes at the first $ that may close", () => {
    expect(formulas("From $5 to $x$ and back")).toEqual(["$5 to $x$"]);
  });

  it("keeps escaped dollars and backslashes inside", () => {
    expect(formulas("$a \\$ b$ and $\\{x\\}$")).toEqual(["$a \\$ b$", "$\\{x\\}$"]);
  });

  it("reads formulas over line breaks in a paragraph", () => {
    expect(formulas("$a +\nb$")).toEqual(["$a +\nb$"]);
  });

  it("reads GitHub's $`…`$ form", () => {
    expect(formulas("Root: $`\\sqrt{3}`$ here")).toEqual(["$\\sqrt{3}$"]);
  });

  it("reads $$…$$ in text, and shows it as a block when alone in its paragraph", () => {
    expect(formulas("Inline $$x^2$$ here")).toEqual(["$x^2$"]);
    expect(formulas("$$x^2$$")).toEqual(["$$x^2$$"]);
  });

  it("reads $$ blocks and ```math fences", () => {
    expect(formulas("$$\n\\int_0^1 f\n$$")).toEqual(["$$\\int_0^1 f$$"]);
    expect(formulas("```math\na^2 + b^2 = c^2\n```")).toEqual(["$$a^2 + b^2 = c^2$$"]);
  });
});

describe("math placeholders", () => {
  const render = (markdown: string) =>
    renderMarkdownTree(parseMarkdown(markdown), document, { path: "docs/A.md", interactiveCheckboxes: false });

  it("shows the source until typeset, and offers to copy blocks as LaTeX", () => {
    const { formulas: found, fragment } = render("Inline $a<b$.\n\n$$\n\\frac{1}{2}\n$$");
    expect(found.map(({ source, display }) => [source, display])).toEqual([
      ["a<b", false],
      ["\\frac{1}{2}", true],
    ]);
    const container = document.createElement("div");
    container.append(fragment);
    expect(container.querySelector("p > .md-math > .md-math-source")?.textContent).toBe("a<b");
    expect(container.querySelector("div.md-math.is-display [aria-label='Copy LaTeX']")?.getAttribute("data-copy")).toBe("\\frac{1}{2}");
    expect(container.querySelector("b")).toBeNull();
  });
});
