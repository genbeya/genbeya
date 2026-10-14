---
id: GENBEYA-29
title: Switching between edit and preview scrolls back to the top
type: bug
status: backlog
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
