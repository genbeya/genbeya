---
id: GENBEYA-27
title: Typed characters turn into other glyphs in the editor (###, <->)
type: bug
status: backlog
priority: medium
labels: [feedback, editor]
---

Reported by a tester, for Markdown files:

> When I type "###", after the third hashtag the first disappears and then reappears when I write text.

> When I want to make a double arrow (`<->`) weird things happen.

To reproduce: edit any page (or a Markdown file in **Code**) and type `<->` slowly, then `###`.

## Comments

### Claude — 2026-10-14 00:40+02:00

**Triage: fix, after a decision.** Reproduced in the web demo (same client as the desktop app).

- The text is never changed: after every keystroke the document holds exactly what was typed (`a <-> b`, `### Title`). It is only drawn differently.
- The cause is the editor font, JetBrains Mono, whose ligatures are on: `<-` is drawn as `←` while typing, `<->` as one long `⟷`, and `##` / `###` as joined hashes. So `<->` morphs twice while typing, which matches "weird things".
- `###` could not be reproduced exactly: the hashes are joined into one connected glyph, which at the editor's 13 px can read as fewer hashes, but none disappears. Probably the same cause; a short screen recording from the tester would confirm.
- Related: `body` sets Inter's `font-feature-settings: "cv11", "ss01"` (`src/client/styles/base.css`), which the editors inherit; in JetBrains Mono those switch glyph variants of their own.

Plan: turn ligatures off in the editors (`font-variant-ligatures: none` and no inherited feature settings for the monospace font), at least in Markdown, where `->` and `##` are text, not operators.

To decide: off everywhere (Markdown and code), or off in Markdown only, or a setting (default off)? I'd turn them off everywhere and add a setting only if someone asks for ligatures in code.
