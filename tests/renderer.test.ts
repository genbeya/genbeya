import { expect, test } from "vitest";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import { remarkGitdesk, type GitdeskOptions } from "../src/markdown/remark-gitdesk";
import { resolveHref, toggleTaskAt } from "../src/markdown/Markdown";
import { layoutGraph } from "../src/views/history/graph";
import { score } from "../src/app/fuzzy";
import type { Commit } from "../shared/api";

const html = (markdown: string, options: GitdeskOptions = {}) =>
  String(
    unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkGitdesk, options)
      .use(remarkRehype)
      .use(rehypeStringify)
      .processSync(markdown),
  );

test("[TOC] lists h2–h4 headings with matching ids", () => {
  const out = html("# Title\n\n[TOC]\n\n## One\n\n### One A\n\n## Two\n\n## Two\n");
  expect(out).toContain('<h2 id="one">One</h2>');
  expect(out).toContain('<h2 id="two-1">Two</h2>');
  expect(out).toMatch(/<ul class="md-toc">[\s\S]*href="#one"[\s\S]*href="#one-a"[\s\S]*href="#two-1"/);
  expect(html("[[_TOC_]]\n\nNo headings.")).toContain("md-placeholder");
});

test("[SUBPAGES] lists the page tree below the current page", () => {
  const out = html("[SUBPAGES]", {
    subpages: [{ title: "Backend", path: "docs/A/Backend.md", children: [{ title: "Auth", path: "docs/A/Backend/Auth.md", children: [] }] }],
  });
  expect(out).toMatch(/md-subpages[\s\S]*href="\/docs\/A\/Backend.md"[\s\S]*href="\/docs\/A\/Backend\/Auth.md"/);
});

test("wiki links match titles loosely; task IDs link to tasks", () => {
  const out = html("See [[getting started]], [[Content branch|the branch]], [[Nope]] and GENBEYA-3, not GENBEYA-99.", {
    pages: [
      { title: "Getting started", path: "docs/Getting-started.md" },
      { title: "Content branch", path: "docs/Content-branch.md" },
    ],
    tasks: [{ id: "GENBEYA-3", path: "tasks/GENBEYA-3.md" }],
  });
  expect(out).toContain('<a href="/docs/Getting-started.md">getting started</a>');
  expect(out).toContain('<a href="/docs/Content-branch.md">the branch</a>');
  expect(out).toContain('href="gitdesk-missing:Nope"');
  expect(out).toContain('<a href="/tasks/GENBEYA-3.md" class="md-task-ref">GENBEYA-3</a>');
  expect(out).toContain("not GENBEYA-99.");
  // Code is left alone.
  expect(html("`[[Page]]` and `GENBEYA-3`", { tasks: [{ id: "GENBEYA-3", path: "t.md" }] })).not.toContain("<a");
});

test("callouts become styled blockquotes", () => {
  const out = html("> [!WARNING]\n> Careful here.");
  expect(out).toContain('<blockquote class="callout callout-warning" data-callout="warning">');
  expect(out).toContain("Careful here.");
  expect(out).not.toContain("[!WARNING]");
});

test("links resolve relative to the document", () => {
  expect(resolveHref("docs/Guide/Wiki.md", "Tasks.md")).toEqual({ kind: "file", path: "docs/Guide/Tasks.md", anchor: undefined });
  expect(resolveHref("docs/Guide/Wiki.md", "../Home.md#start-here")).toEqual({ kind: "file", path: "docs/Home.md", anchor: "start-here" });
  expect(resolveHref("docs/Home.md", "/src/main.ts")).toEqual({ kind: "file", path: "src/main.ts", anchor: undefined });
  expect(resolveHref("docs/Home.md", "../../../etc/passwd")).toEqual({ kind: "file", path: "etc/passwd", anchor: undefined });
  expect(resolveHref("docs/Home.md", "https://example.com")).toEqual({ kind: "external", url: "https://example.com" });
  expect(resolveHref("docs/Home.md", "#top")).toEqual({ kind: "anchor", id: "top" });
});

test("task checkboxes toggle at their source position", () => {
  const body = "- [ ] one\n- [x] two\n";
  expect(toggleTaskAt(body, 0)).toBe("- [x] one\n- [x] two\n");
  expect(toggleTaskAt(body, body.indexOf("- [x]"))).toBe("- [ ] one\n- [ ] two\n");
});

test("palette scoring prefers substring and word-start matches", () => {
  expect(score("Getting started", "start")).toBeGreaterThan(score("Restart service", "start"));
  expect(score("workspace.ts", "wsts")).toBeGreaterThan(0);
  expect(score("workspace.ts", "xyz")).toBe(-1);
});

const commit = (hash: string, parents: string[]): Commit => ({
  hash, parents, author: "a", email: "", date: "2026-01-01T00:00:00Z", subject: hash, refs: [],
});

test("commit graph lanes follow parents and merges", () => {
  // m merges f into c; f and c both descend from r.
  const { rows, lanes } = layoutGraph([commit("m", ["c", "f"]), commit("f", ["r"]), commit("c", ["r"]), commit("r", [])]);
  expect(lanes).toBe(2);
  expect(rows[0]).toMatchObject({ lane: 0, into: [], out: [0, 1] });
  expect(rows[1]).toMatchObject({ lane: 1, into: [1], through: [[0, 0]], out: [1] });
  // c takes over r on lane 0; f's line bends back into it.
  expect(rows[2]).toMatchObject({ lane: 0, into: [0], through: [[1, 0]], out: [0] });
  expect(rows[3]).toMatchObject({ lane: 0, into: [0], through: [], out: [] });
});
