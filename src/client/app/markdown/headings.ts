/** Heading ids as pages render them, and the heading a line of Markdown belongs to. */
import GithubSlugger from "github-slugger";
import type { Heading, Root } from "mdast";
import { toString } from "mdast-util-to-string";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

/** Every heading of `tree` in document order, with its id: GitHub's slug of its text, numbered when repeated. */
export function headingIds(tree: Root): { heading: Heading; id: string }[] {
  const slugger = new GithubSlugger();
  const headings: { heading: Heading; id: string }[] = [];
  visit(tree, "heading", (heading: Heading) => {
    headings.push({ heading, id: slugger.slug(toString(heading)) });
  });
  return headings;
}

/** The id of the last heading starting at or above `line` (1-based) of `source`; null when there is none. */
export function headingAt(source: string, line: number): string | null {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(source);
  let id: string | null = null;
  for (const heading of headingIds(tree)) {
    if ((heading.heading.position?.start.line ?? Infinity) > line) break;
    id = heading.id;
  }
  return id;
}
