---
id: GENBEYA-37
title: Checkboxes on wiki pages can't be ticked
type: bug
status: backlog
priority: medium
labels: [wiki]
---

Task lists (`- [ ]`) on wiki pages can't be ticked in the page view, but they can in a task's description.

### Claude — 2026-10-20 14:41+02:00

Confirmed. The renderer supports ticking (`markdown-view`'s `checkboxes` input and `checkboxToggled` output), but only the task panel turns it on. It toggles the box with `toggleCheckboxAt` and saves. The wiki page doesn't pass `[checkboxes]="true"`.

Plan:

- Wire the wiki page the same way: a click ticks the box in the page's source and saves it, with the page's version, so a page that changed meanwhile is refused instead of overwritten. This is just like an edit, and it is committed like one.
- Not while editing: there, the source is the place to tick it.
- Check the same in the VS Code extension's page preview.
