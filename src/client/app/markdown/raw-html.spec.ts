import { renderMarkdownTree } from "./markdown-dom";
import { parseMarkdown } from "./markdown-pipeline";

function render(markdown: string) {
  const container = document.createElement("div");
  container.append(renderMarkdownTree(parseMarkdown(markdown), document, { path: "docs/A.md", interactiveCheckboxes: true }).fragment);
  return container;
}

const attributes = (container: HTMLElement) => [...container.querySelectorAll("*")].flatMap((element) => element.getAttributeNames());

describe("keys and inline tags", () => {
  it("renders <kbd>, <sub>, <sup> and <br>", () => {
    const container = render("Press <kbd>Ctrl</kbd>+<kbd>C</kbd>, H<sub>2</sub>O, x<sup>*n*</sup><br>next");
    expect([...container.querySelectorAll("kbd")].map((key) => key.textContent)).toEqual(["Ctrl", "C"]);
    expect(container.querySelector("sub")?.textContent).toBe("2");
    expect(container.querySelector("sup > em")?.textContent).toBe("n");
    expect(container.querySelector("br")).not.toBeNull();
  });

  it("makes GitHub's nested keys separate keys", () => {
    const container = render("<kbd><kbd>Ctrl</kbd>+<kbd>C</kbd></kbd>");
    expect([...container.querySelectorAll("kbd")].map((key) => [key.textContent, key.children.length])).toEqual([
      ["Ctrl", 0],
      ["C", 0],
    ]);
  });

  it("nests different inline tags", () => {
    const container = render("x<sup>y <kbd>z</kbd></sup> and <sub><sup>a</sup></sub>");
    expect(container.querySelector("sup > kbd")?.textContent).toBe("z");
    expect(container.querySelector("sup")?.textContent).toBe("y z");
    expect(container.querySelector("sub > sup")?.textContent).toBe("a");
  });

  it.each(['<kbd onclick="alert(1)">x</kbd>', '<kbd style="position:fixed">x</kbd>', "<KBD >x</kbd>", "<kbd>x", "x</kbd>", "<kbd>x</sub>"])(
    "drops %s but keeps its text",
    (markdown) => {
      const container = render(markdown);
      expect(container.querySelector("kbd, sub")).toBeNull();
      expect(container.textContent).toContain("x");
      expect(attributes(container)).toEqual([]);
    },
  );

  it("keeps tags in code as code", () => {
    expect(render("`<kbd>x</kbd>`").querySelector("code")?.textContent).toBe("<kbd>x</kbd>");
  });
});

describe("collapsible sections", () => {
  it("renders <details> with its summary and Markdown content", () => {
    const container = render(
      "<details>\n<summary>More <b>info</b> &amp; links</summary>\n\nSome **bold** text.\n\n- [ ] task\n\n</details>\n\nAfter.",
    );
    const details = container.querySelector("details.md-details")!;
    expect(details.hasAttribute("open")).toBe(false);
    expect(details.querySelector("summary")?.textContent).toBe("More info & links");
    expect(details.querySelector("summary b")).toBeNull();
    expect(details.querySelector("strong")?.textContent).toBe("bold");
    expect(details.querySelector(".md-check.is-interactive")).not.toBeNull();
    expect(container.lastElementChild?.textContent).toBe("After.");
  });

  it("opens with open, takes a summary on its own, and parses text inside the tags", () => {
    const container = render(
      '<details open="">\n\n<summary>Title</summary>\n\nBody\n\n</details>\n\n<details><summary>Short</summary>Inline *text*</details>',
    );
    const [open, short] = [...container.querySelectorAll("details")];
    expect(open?.hasAttribute("open")).toBe(true);
    expect(open?.querySelector("summary")?.textContent).toBe("Title");
    expect(open?.querySelector("p")?.textContent).toBe("Body");
    expect(short?.querySelector("summary")?.textContent).toBe("Short");
    expect(short?.querySelector("em")?.textContent).toBe("text");
  });

  it("nests sections and names untitled ones", () => {
    const container = render("<details>\n\nOuter\n\n<details>\n\nInner\n\n</details>\n\n</details>");
    const outer = container.querySelector("details")!;
    expect(outer.querySelector("summary")?.textContent).toBe("Details");
    expect(outer.querySelector(":scope details p")?.textContent).toBe("Inner");
    expect(container.querySelectorAll("details")).toHaveLength(2);
  });

  it("nests sections written in one HTML block, as GitHub does", () => {
    const container = render("<details><summary>Outer</summary>\n<details><summary>Inner</summary>\ntext\n</details>\n</details>\n\nAfter");
    const outer = container.querySelector("details")!;
    expect(outer.querySelector(":scope > summary")?.textContent).toBe("Outer");
    const inner = outer.querySelector(":scope > details")!;
    expect(inner.querySelector(":scope > summary")?.textContent).toBe("Inner");
    expect(inner.querySelector("p")?.textContent).toBe("text");
    expect(container.lastElementChild?.textContent).toBe("After");
  });

  it("nests a section that starts in the outer one's HTML block and ends later", () => {
    const container = render(
      "<details><summary>Outer</summary>\n<details><summary>Inner</summary>\n\ninner text\n\n</details>\n\nouter text\n\n</details>",
    );
    const outer = container.querySelector("details")!;
    expect(outer.querySelector(":scope > details > p")?.textContent).toBe("inner text");
    expect(outer.querySelector(":scope > p")?.textContent).toBe("outer text");
    expect(container.querySelectorAll("details")).toHaveLength(2);
  });

  it("typesets math in the text inside the tags", () => {
    const container = render("<details><summary>Formulas</summary>\n$x^2$ inline\n```math\ny\n```\n</details>");
    const formulas = [...container.querySelectorAll("details .md-math")];
    expect(formulas.map((formula) => [formula.textContent, formula.classList.contains("is-display")])).toEqual([
      ["x^2", false],
      ["y", true],
    ]);
  });

  it("works inside lists and quotes", () => {
    expect(
      render("> <details>\n> <summary>Q</summary>\n>\n> A\n>\n> </details>").querySelector("blockquote details summary")?.textContent,
    ).toBe("Q");
  });

  it.each([
    "<details ontoggle=alert(1) open>\n\nx\n\n</details>",
    '<details open onclick="alert(1)">\n\nx\n\n</details>',
    "<details>\n<summary onclick=alert(1)>s</summary>\n\nx\n\n</details>",
    "<details>\n\nx",
    "x\n\n</details>",
    "<details class=evil>\n\nx\n\n</details>",
  ])("drops the tags of %s but keeps its text", (markdown) => {
    const container = render(markdown);
    expect(container.querySelector("details, summary")).toBeNull();
    expect(container.textContent).toContain("x");
    expect(attributes(container)).toEqual([]);
  });

  it("keeps the summary as text", () => {
    const container = render("<details>\n<summary><img src=x onerror=alert(1)><script>alert(1)</script>Hi</summary>\n\nx\n\n</details>");
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.querySelector("summary")?.textContent).toBe("alert(1)Hi");
  });
});
