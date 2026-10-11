/** Markdown → HTML syntax tree: GitHub Flavored Markdown, GitDesk's wiki extensions, mentions, dates, code highlighting. */
import type { Root } from "hast";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { remarkDates } from "./dates";
import { remarkMentions } from "./mentions";
import { remarkGitdesk, type GitdeskOptions } from "./remark-gitdesk";

/** Languages whose code blocks are diagrams or plain text, never highlighted. */
const PLAIN = ["mermaid", "plantuml", "puml", "text", "txt"];

export function parseMarkdown(source: string, options: GitdeskOptions = {}): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkGitdesk, options)
    // After references, so text inside them stays as written.
    .use(remarkMentions, options)
    .use(remarkDates, options)
    // Raw HTML in Markdown is dropped: pages render only what Markdown can express.
    .use(remarkRehype)
    .use(rehypeHighlight, { plainText: PLAIN, detect: false });
  return processor.runSync(processor.parse(source)) as Root;
}

export type { GitdeskOptions, PageRef } from "./remark-gitdesk";
