import { renderMarkdownTree } from "./markdown-dom";
import { parseMarkdown, type GenbeyaOptions } from "./markdown-pipeline";
import type { ReferenceSources } from "./references";

const references: ReferenceSources = {
  wikiRoot: "docs",
  pages: [
    { title: "Getting started", path: "docs/Getting-started.md" },
    { title: "Content branch", path: "docs/Content-branch.md" },
  ],
  tasks: [{ id: "GENBEYA-3", path: "tasks/GENBEYA-3.md", title: "Login", status: "in-progress" }],
  statuses: ["todo", "in-progress", "done"],
  files: ["src/app.ts"],
};

function render(markdown: string, options: GenbeyaOptions = {}, interactiveCheckboxes = false) {
  const rendered = renderMarkdownTree(parseMarkdown(markdown, options), document, { path: "docs/Guide/Wiki.md", interactiveCheckboxes });
  const container = document.createElement("div");
  container.append(rendered.fragment);
  return { ...rendered, container, html: container.innerHTML };
}

describe("wiki extensions", () => {
  it("lists h2–h4 headings for [TOC], with matching ids", () => {
    const { html } = render("# Title\n\n[TOC]\n\n## One\n\n### One A\n\n## Two\n\n## Two\n");
    expect(html).toContain('<h2 id="one">One</h2>');
    expect(html).toContain('<h2 id="two-1">Two</h2>');
    expect(html).toMatch(/<ul class="md-toc">[\s\S]*href="#one"[\s\S]*href="#one-a"[\s\S]*href="#two-1"/);
    expect(render("[[_TOC_]]\n\nNo headings.").html).toContain("md-placeholder");
  });

  it("lists the pages below the current one for [SUBPAGES]", () => {
    const { html } = render("[SUBPAGES]", {
      subpages: [
        { title: "Backend", path: "docs/A/Backend.md", children: [{ title: "Auth", path: "docs/A/Backend/Auth.md", children: [] }] },
      ],
    });
    expect(html).toMatch(/md-subpages[\s\S]*href="\/docs\/A\/Backend.md"[\s\S]*href="\/docs\/A\/Backend\/Auth.md"/);
  });

  it("links wiki titles loosely and task IDs to tasks, but not inside code", () => {
    const { container } = render("See [[getting started]], [[Content branch|the branch]], [[Nope]] and GENBEYA-3, not GENBEYA-99.", {
      references,
    });
    const pages = [...container.querySelectorAll<HTMLAnchorElement>("a.md-ref-page")];
    expect(pages.map((link) => [link.getAttribute("href"), link.textContent])).toEqual([
      ["/docs/Getting-started.md", "Getting started"],
      ["/docs/Content-branch.md", "the branch"],
    ]);
    expect(pages[0]!.querySelector("svg")).not.toBeNull();
    const missing = container.querySelector(".md-missing")!;
    expect([missing.getAttribute("href"), missing.getAttribute("title"), missing.textContent]).toEqual([
      "genbeya-missing:Nope",
      "Create this page",
      "Nope",
    ]);
    const id = container.querySelector(".md-task-ref")!;
    expect([id.getAttribute("href"), id.getAttribute("title"), id.textContent]).toEqual([
      "/tasks/GENBEYA-3.md",
      "Login (In progress)",
      "GENBEYA-3",
    ]);
    expect(container.textContent).toContain("not GENBEYA-99.");
    expect(render("`[[Page]]` and `GENBEYA-3`", { references }).html).not.toContain("<a");
  });

  it("shows task references with ID, title and state", () => {
    const task = render("Blocked by [[GENBEYA-3]].", { references }).container.querySelector("a.md-ref-task")!;
    expect(task.getAttribute("href")).toBe("/tasks/GENBEYA-3.md");
    expect([...task.children].map((part) => [part.className, part.textContent])).toEqual([
      ["md-ref-dot tone-blue", ""],
      ["md-ref-id", "GENBEYA-3"],
      ["md-ref-title", "Login"],
      ["md-ref-state tone-blue", "In progress"],
    ]);
  });

  it("shows file references with their path and lines, and marks files that are gone", () => {
    const { container } = render("[[src/app.ts#L3-L9]], [[src/app.ts|the app]] and [[src/gone.ts]]", { references });
    const files = [...container.querySelectorAll("a.md-ref-file")];
    expect(files.map((link) => [link.getAttribute("href"), link.textContent, link.classList.contains("md-ref-missing")])).toEqual([
      ["/src/app.ts#L3-L9", "src/app.ts:3–9", false],
      ["/src/app.ts", "the app", false],
      ["/src/gone.ts", "src/gone.ts", true],
    ]);
  });

  it("embeds lines of a file given alone in a paragraph, and links anything else", () => {
    const { embeds, container } = render("![[src/app.ts#L3-L9]]\n\n![[src/app.ts]]\n\n![[GENBEYA-3]]", { references });
    expect(embeds.map(({ path, lines }) => [path, lines])).toEqual([
      ["src/app.ts", "3-9"],
      ["src/app.ts", null],
    ]);
    expect(embeds[0]!.element.className).toBe("md-embed");
    expect(container.querySelector("a.md-ref-task")).not.toBeNull();
  });

  it("turns GitHub callouts into styled blockquotes", () => {
    const { html } = render("> [!WARNING]\n> Careful here.");
    expect(html).toContain('<blockquote data-callout="warning" class="callout callout-warning">');
    expect(html).not.toContain("[!WARNING]");
  });
});

describe("code, tables, checkboxes and diagrams", () => {
  it("highlights code and offers to copy it", () => {
    const { container } = render("```ts\nconst a = 1;\n```");
    expect(container.querySelector(".md-code-bar span")?.textContent).toBe("ts");
    expect(container.querySelector("pre .hljs-keyword")?.textContent).toBe("const");
    expect(container.querySelector<HTMLElement>("[aria-label='Copy code']")?.dataset["copy"]).toBe("const a = 1;");
  });

  it("wraps tables for scrolling", () => {
    expect(render("| a |\n| - |\n| 1 |").container.querySelector(".md-table > table td")?.textContent).toBe("1");
  });

  it("makes task checkboxes clickable at their source offset", () => {
    const source = "Intro\n\n- [ ] one\n- [x] two\n";
    const boxes = [...render(source, {}, true).container.querySelectorAll<HTMLElement>(".md-check")];
    expect(boxes.map((box) => [box.getAttribute("aria-checked"), Number(box.dataset["offset"])])).toEqual([
      ["false", source.indexOf("- [ ]")],
      ["true", source.indexOf("- [x]")],
    ]);
    expect(render(source).container.querySelector(".md-check.is-interactive")).toBeNull();
  });

  it("leaves placeholders for diagrams", () => {
    const { diagrams } = render("```mermaid\ngraph TD; A-->B\n```\n\n```puml\n@startuml\nA -> B\n@enduml\n```");
    expect(diagrams.map((d) => [d.language, d.source])).toEqual([
      ["mermaid", "graph TD; A-->B"],
      ["plantuml", "@startuml\nA -> B\n@enduml"],
    ]);
  });

  it("loads repository images relative to the page and never loads remote ones", () => {
    const { images, container } = render("![Logo](../logo.png) ![Web](https://example.com/x.png)");
    expect(images.map((i) => i.path)).toEqual(["docs/logo.png"]);
    expect(container.querySelector("img")?.getAttribute("src")).toBeNull();
    expect(container.querySelector(".md-remote-image")?.getAttribute("href")).toBe("https://example.com/x.png");
  });
});

describe("safety", () => {
  it("drops raw HTML", () => {
    const { html } = render('<script>alert(1)</script><img src=x onerror=alert(1)><iframe src="x"></iframe>\n\nText');
    expect(html).not.toMatch(/script|onerror|iframe/);
    expect(html).toContain("Text");
  });

  it.each(["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "vbscript:x"])(
    "keeps the text but not the link of %s",
    (url) => {
      const { container } = render(`[click](${url})`);
      const anchor = container.querySelector("a");
      expect(anchor?.textContent).toBe("click");
      expect(anchor?.hasAttribute("href")).toBe(false);
    },
  );

  it("keeps safe links", () => {
    for (const href of ["https://example.com", "mailto:a@b.c", "#part", "Other.md", "../x/y.md", "/src/main.ts"])
      expect(render(`[x](${href})`).container.querySelector("a")?.getAttribute("href")).toBe(href);
  });
});

describe("source lines", () => {
  const lines = (markdown: string, lineOffset?: number) => {
    const rendered = renderMarkdownTree(parseMarkdown(markdown), document, {
      path: "docs/Home.md",
      interactiveCheckboxes: false,
      ...(lineOffset === undefined ? {} : { lineOffset }),
    });
    const container = document.createElement("div");
    container.append(rendered.fragment);
    return [...container.querySelectorAll<HTMLElement>("[data-line]")].map(
      (element) => `${element.tagName.toLowerCase()}:${element.dataset["line"]}`,
    );
  };

  it("marks blocks with the line they start at, counting the lines above the source", () => {
    expect(lines("# Title\n\nIntro.\n\n- one\n- two\n", 3)).toEqual(["h1:4", "p:6", "li:8", "li:9"]);
  });

  it("marks nothing unless asked", () => {
    expect(lines("# Title\n\nIntro.\n")).toEqual([]);
  });
});
