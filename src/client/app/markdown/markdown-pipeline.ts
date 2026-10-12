/** Markdown → HTML syntax tree: GitHub Flavored Markdown, math, Genbeya's wiki extensions, mentions, dates, code highlighting. */
import type { Root } from "hast";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { remarkCallouts } from "./callouts";
import { rehypeCodeBlocks, remarkCodeBlocks } from "./code-blocks";
import { remarkDates } from "./dates";
import { remarkMath } from "./math";
import { remarkMentions } from "./mentions";
import { remarkRawHtml } from "./raw-html";
import { remarkGenbeya, type GenbeyaOptions } from "./remark-genbeya";

/** Languages whose code blocks are diagrams or plain text, never highlighted. */
const PLAIN = ["mermaid", "plantuml", "puml", "text", "txt"];

export function parseMarkdown(source: string, options: GenbeyaOptions = {}): Root {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    // Other raw HTML in Markdown is dropped: pages render only what Markdown can express.
    // Before math, which then also finds the formulas in the text of HTML blocks.
    .use(remarkRawHtml)
    .use(remarkMath)
    .use(remarkCallouts)
    .use(remarkCodeBlocks)
    .use(remarkGenbeya, options)
    // After references, so text inside them stays as written.
    .use(remarkMentions, options)
    .use(remarkDates, options)
    .use(remarkRehype)
    .use(rehypeHighlight, { plainText: PLAIN, detect: false })
    .use(rehypeCodeBlocks);
  return processor.runSync(processor.parse(source), source) as Root;
}

export type { GenbeyaOptions, PageRef } from "./remark-genbeya";
