---
id: GENBEYA-31
title: Side-by-side edit and preview for Markdown files in Code
type: feature
status: backlog
priority: medium
labels: [feedback, editor]
---

Reported by a tester:

> For md files in Code there is no side-by-side edit/preview function. There's only such a function in Wiki. Could this not easily be added to the Code part?

## Comments

### Claude — 2026-10-14 00:40+02:00

**Triage: decide first, then a small feature.** Confirmed: in Code, a Markdown file has an **Edit | Preview** switch (`features/code/file-editor.ts`); the wiki's editor has the side-by-side preview with its toggle (`features/wiki/wiki-page.ts`).

Plan: make the switch in Code **Edit | Split | Preview** and reuse the wiki's split layout, so both behave alike. With [[GENBEYA-29]]'s line mapping the two sides can scroll together.

To decide:

- Remember the choice per file type, per file, or one choice for all Markdown files? I'd remember one choice for all Markdown files, like the wiki's preview toggle.
- Should the wiki get the same three-way switch instead of its toggle, so the two views match?

### Emanuel Knecht — 2026-10-14 01:32+02:00

having a preview fo certain files will be very useful indeed, not only markdown.. three-way switch sounds good.
