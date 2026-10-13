---
id: GENBEYA-29
title: Switching between edit and preview scrolls back to the top
type: bug
status: review
priority: medium
labels: [feedback, editor, wiki]
---

Reported by a tester (translated from German):

> When I switch between Edit and Preview in Markdown files, the page jumps back to the top, and you have to scroll every time.

To reproduce:

1. Wiki: scroll down a long page, press **Edit**: the editor and its preview start at the top.
2. Code: open a long Markdown file, scroll the editor, switch to **Preview**, then back to **Edit**: each switch starts at the top.

## Comments

### Claude — 2026-10-14 00:40+02:00

**Triage: fix.** Reproduced in both places in the web demo (wiki page scrolled to 451 px → editor at 0; Code editor at 112 px → preview at 0 → editor at 0).

Cause: the editor and the rendered page are separate components that replace each other, and neither is told where the other was (`wiki-page.ts`, `features/code/file-editor.ts`).

Plan: keep the place by source line, not by pixels, since text and rendering have different heights:

1. The Markdown renderer marks block elements with the source line they start at (the syntax tree has positions; `data-line` on the rendered blocks).
2. Leaving the preview: the first block in view gives the line; the editor scrolls that line to the top. Leaving the editor: its first visible line gives the block to scroll to.

The same mapping can scroll the wiki's side-by-side preview along with the editor, and replace the share-of-length scrolling in the VS Code extension's **Open Preview to the Side** ([[GENBEYA-22]]).

### Emanuel Knecht — 2026-10-14 01:27+02:00

yes and lets discuss a tangent one: scrolling while we have code and preview side-by-side.. how hard would it be to keep both side s more or less in sync?

### Claude — 2026-10-14 03:10+02:00

Done, including the side-by-side scrolling discussed above:

- The Markdown renderer can mark blocks with the source line they start at (`data-line`, opt-in through `lineOffset`, which also counts a frontmatter that isn't rendered). `markdown/source-lines.ts` turns a scrolled page into a source line and back, interpolating between blocks; the editor gets `topLine()`, `scrollToLine()` and a `scrolled` output.
- Wiki: **Edit** opens the editor and its preview at the line you were reading; leaving the editor returns the page to where the editor was.
- Code: switching between Edit, Split and Preview keeps the line ([[GENBEYA-31]]).
- Side by side (the wiki's editor with its preview, Code's Split), whichever side you scroll leads and the other follows (`editor/scroll-link.ts`, which ignores the follower's echo so they don't chase each other).

How hard was syncing? Small, once the line mapping existed: precise between blocks, interpolated inside long ones (a big table or code block moves smoothly rather than line by line). An editor shorter than its preview stops at its end, so the two can't always line up at the bottom.
