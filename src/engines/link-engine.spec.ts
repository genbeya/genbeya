import { describe, expect, it } from "vitest";
import { referenceIndex } from "../utilities/references";
import { relocate, within } from "../utilities/repository-path";
import { LinkEngine, type MoveContext } from "./link-engine";
import { WikiEngine } from "./wiki-engine";

const engine = new LinkEngine();
const wiki = new WikiEngine();
const settings = { wikiRoot: "docs", wikiHome: "Home.md" };
const FILES = [
  "README.md",
  "docs/Home.md",
  "docs/Guide.md",
  "docs/Guide/Wiki.md",
  "docs/Guide/diagram.png",
  "docs/Getting-started.md",
  "docs/My Page.md",
  "docs/Other/Page.md",
  "tasks/GENBEYA-1.md",
  "src/app.ts",
];

/** What the content manager passes for moving the page `from` to `to`. */
function moving(from: string, to: string): MoveContext {
  const moves = wiki.planMove(
    from,
    to,
    FILES.some((file) => within(file, wiki.subpageFolder(from))),
  );
  const index = (files: readonly string[]) =>
    referenceIndex({ wikiRoot: "docs", pages: wiki.pages(files, settings), tasks: [{ id: "GENBEYA-1" }], files });
  return { moves, before: index(FILES), after: index(FILES.map((file) => relocate(file, moves) ?? file)) };
}

/** The content of `path` after the move; unchanged when nothing needed rewriting. */
function rewritten(path: string, content: string, context: MoveContext): string {
  return engine.rewrite([{ path, content }], context)[0]?.content ?? content;
}

describe("LinkEngine: renaming docs/Guide.md to docs/Manual.md", () => {
  const context = moving("docs/Guide.md", "docs/Manual.md");

  it.each([
    ["docs/Home.md", "[g](Guide.md)", "[g](Manual.md)"],
    ["docs/Home.md", "[w](Guide/Wiki.md#links)", "[w](Manual/Wiki.md#links)"],
    ["docs/Home.md", '[g](./Guide.md "The guide")', '[g](./Manual.md "The guide")'],
    ["docs/Home.md", "[g](Guide)", "[g](Manual)"],
    ["docs/Home.md", "[g]( <Guide.md> )", "[g]( <Manual.md> )"],
    ["docs/Home.md", "![d](Guide/diagram.png)", "![d](Manual/diagram.png)"],
    ["docs/Home.md", "[![d](Guide/diagram.png)](Guide.md)", "[![d](Manual/diagram.png)](Manual.md)"],
    ["docs/Home.md", "[g][ref]\n\n[ref]: Guide.md 'Guide'", "[g][ref]\n\n[ref]: Manual.md 'Guide'"],
    ["docs/Home.md", "[g](/docs/Guide.md)", "[g](/docs/Manual.md)"],
    ["docs/Other/Page.md", "[w](../Guide/Wiki.md)", "[w](../Manual/Wiki.md)"],
    ["README.md", "[g](docs/Guide.md)", "[g](docs/Manual.md)"],
    ["tasks/GENBEYA-1.md", "[w](../docs/Guide/Wiki.md)", "[w](../docs/Manual/Wiki.md)"],
    ["docs/Home.md", "[[Guide/Wiki]]", "[[Manual/Wiki]]"],
    ["docs/Home.md", "[[Guide/Wiki.md|the wiki]]", "[[Manual/Wiki.md|the wiki]]"],
    ["docs/Home.md", "[[docs/Guide/Wiki#Links]]", "[[docs/Manual/Wiki#Links]]"],
    ["docs/Home.md", "[[/docs/Guide/Wiki.md]]", "[[/docs/Manual/Wiki.md]]"],
    ["docs/Home.md", "[[ guide ]]", "[[ Manual ]]"],
    ["docs/Home.md", "[[Guide#Intro|read this]]", "[[Manual#Intro|read this]]"],
    ["docs/Home.md", "![[docs/Guide/diagram.png]]", "![[docs/Manual/diagram.png]]"],
    ["tasks/GENBEYA-1.md", "---\nid: GENBEYA-1\n---\nSee [[Guide/Wiki]].", "---\nid: GENBEYA-1\n---\nSee [[Manual/Wiki]]."],
    [
      "docs/Guide/Wiki.md",
      "[up](../Guide.md) [home](../Home.md) [d](diagram.png)",
      "[up](../Manual.md) [home](../Home.md) [d](diagram.png)",
    ],
  ])("rewrites in %s: %s", (path, before, after) => {
    expect(rewritten(path, before, context)).toBe(after);
  });

  it.each([
    ["a title that stays", "[[Wiki]] and [[Home]]"],
    ["a task", "[[GENBEYA-1]]"],
    ["a code file", "[[src/app.ts#L1-L2]]"],
    ["an external link", "[x](https://example.com/docs/Guide.md)"],
    ["an anchor", "[x](#guide)"],
    ["a fenced code block", "```md\n[g](Guide.md) [[Guide/Wiki]]\n```"],
    ["an indented code block", "    [g](Guide.md)"],
    ["inline code", "`[g](Guide.md)` and ``[[Guide/Wiki]]``"],
    ["a reference inside a link's text", "[see [[Guide/Wiki]]](Home.md)"],
    ["an unrelated page", "[o](Other/Page.md) [[Getting started]]"],
    ["a missing page", "[[Glossary]]"],
  ])("leaves %s alone", (_, content) => {
    expect(rewritten("docs/Home.md", content, context)).toBe(content);
  });

  it("keeps everything else byte for byte: byte order mark, CRLF, tabs", () => {
    const content = "﻿# Home\r\n\r\n- [a](Guide.md)\tand\t[[Guide/Wiki]]\r\n\r\n```\r\n[[Guide/Wiki]]\r\n```\r\n";
    expect(rewritten("docs/Home.md", content, context)).toBe(
      "﻿# Home\r\n\r\n- [a](Manual.md)\tand\t[[Manual/Wiki]]\r\n\r\n```\r\n[[Guide/Wiki]]\r\n```\r\n",
    );
  });

  it("reports each change with its line, and skips files without changes", () => {
    const documents = [
      { path: "docs/Home.md", content: "# Home\n\nSee [g](Guide.md).\n\n[[Guide/Wiki|wiki]]\n" },
      { path: "docs/Other/Page.md", content: "[[Home]]\n" },
    ];
    expect(engine.rewrite(documents, context)).toEqual([
      {
        path: "docs/Home.md",
        content: "# Home\n\nSee [g](Manual.md).\n\n[[Manual/Wiki|wiki]]\n",
        changes: [
          { line: 3, before: "Guide.md", after: "Manual.md" },
          { line: 5, before: "Guide/Wiki", after: "Manual/Wiki" },
        ],
      },
    ]);
  });
});

describe("LinkEngine: moving docs/Guide.md to docs/Archive/Guide.md", () => {
  const context = moving("docs/Guide.md", "docs/Archive/Guide.md");

  it.each([
    ["docs/Home.md", "[g](Guide.md) [w](Guide/Wiki.md)", "[g](Archive/Guide.md) [w](Archive/Guide/Wiki.md)"],
    ["docs/Home.md", "[[Guide/Wiki]] [[Guide]]", "[[Archive/Guide/Wiki]] [[Guide]]"],
    ["docs/Guide.md", "[w](Guide/Wiki.md) [h](Home.md) [r](/README.md)", "[w](Guide/Wiki.md) [h](../Home.md) [r](/README.md)"],
    ["docs/Guide/Wiki.md", "[g](../Guide.md) [h](../Home.md) [d](./diagram.png)", "[g](../Guide.md) [h](../../Home.md) [d](./diagram.png)"],
    ["docs/Guide/Wiki.md", "[o](../Other/Page.md#top) [[Home]]", "[o](../../Other/Page.md#top) [[Home]]"],
  ])("rewrites in %s: %s", (path, before, after) => {
    expect(rewritten(path, before, context)).toBe(after);
  });
});

describe("LinkEngine: names that need care", () => {
  it.each([
    ["docs/My Page.md", "docs/Archive/My Page.md", "[p](My%20Page.md)", "[p](Archive/My%20Page.md)"],
    ["docs/My Page.md", "docs/Archive/My Page.md", "[p](<My Page.md>)", "[p](<Archive/My Page.md>)"],
    ["docs/Guide.md", "docs/User Guide.md", "[g](Guide.md)", "[g](User%20Guide.md)"],
    ["docs/Guide.md", "docs/User Guide.md", "[[Guide]]", "[[User Guide]]"],
    ["docs/Guide.md", "docs/guide.md", "[g](Guide.md) [[Guide/Wiki]]", "[g](guide.md) [[guide/Wiki]]"],
    // "Home" would name docs/Home.md, so the reference names the path.
    ["docs/Guide.md", "docs/Archive/Home.md", "[[Guide]]", "[[Archive/Home]]"],
  ])("moving %s to %s rewrites %s", (from, to, before, after) => {
    expect(rewritten("docs/Home.md", before, moving(from, to))).toBe(after);
  });
});
