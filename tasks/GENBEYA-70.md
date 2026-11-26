---
id: GENBEYA-70
title: "Kit additions for the mobile app: outline, reveal and read-only checkboxes"
type: feature
status: done
priority: high
labels: [kit, mobile]
milestone: 0.2.1
---

Three additions to the kit ([[GENBEYA-68]]) that the mobile app needs before it can use the kit instead of building its own. They only add a message or an optional field, so `KIT_PROTOCOL` stays 1; they go into 0.2.1, the first release with the kit.

- [x] `outline` (kit → host): after every render of a `page` or `markdown` preview, also when a new `context` re-renders it, the headings the renderer gave ids, in document order: `level`, `text` (trimmed, at most 300 characters) and `id` (at most 300), at most 500. A document without headings sends none, which still says rendering finished. Not for tasks
- [x] `reveal` (host → kit): scrolls the preview shown to the element with that `id` (`CSS.escape`, `scrollIntoView({ block: "start" })`); nothing while the editor is open or when no element has it, and no `error`. `parseToKit` takes ids of at most 300 characters
- [x] `checkboxes` on a `markdown` preview, optional: `false` renders its checkboxes read-only and sends no `toggle`; absent or `true` ticks them, as before
- [x] `protocol.spec.ts` and `e2e:kit` cover all three; the Kit page in the wiki lists them

### Claude — 2026-11-26 00:17+01:00

Done as the mobile app's spec asks. `follow`'s `anchor` is unchanged: it is the id the heading gets when the linked page renders, so a host opens the page and sends `reveal` with the anchor once that page's `outline` arrives. A theme message also re-renders, so it sends an outline too.
