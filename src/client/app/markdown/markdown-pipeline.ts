/** Markdown → HTML syntax tree: GitHub Flavored Markdown, GitDesk's wiki extensions, code highlighting. */
import type { Root } from "hast";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { remarkGitdesk, type GitdeskOptions } from "./remark-gitdesk";

/** Languages whose code blocks are diagrams or plain text, never highlighted. */
const PLAIN = ["mermaid", "plantuml", "puml", "text", "txt"];

export function parseMarkdown(source: string, options: GitdeskOptions = {}): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkGitdesk, options)
    // Raw HTML in Markdown is dropped: pages render only what Markdown can express.
    .use(remarkRehype)
    .use(rehypeHighlight, { plainText: PLAIN, detect: false });
  return processor.runSync(processor.parse(source)) as Root;
}

export type { GitdeskOptions, PageRef } from "./remark-gitdesk";
