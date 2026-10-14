---
id: GENBEYA-27
title: Typed characters turn into other glyphs in the editor (###, <->)
type: bug
status: review
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

### Emanuel Knecht — 2026-10-14 01:24+02:00

i generall love ligatures.. lets try another font.. maybe fira code or roboto mono.. lets test if it is only an issue with that jetbrains thing or a general ligatures bug.

### Claude — 2026-10-14 03:55+02:00

Tested as asked: the reported sequences typed step by step in JetBrains Mono, Fira Code, Cascadia Code and Roboto Mono (which has no ligatures).

- All three ligature fonts behave the same: `<-` becomes `←` and `<->` a long arrow while typing (also `->`, `=>`), and `##` / `###` are drawn as joined hashes. Roboto Mono shows the characters as typed.
- So it is not a JetBrains Mono bug but what ligatures do; another ligature font won't change it. None of these fonts can switch off single ligatures (only all contextual alternates at once).

Options:

1. **Ligatures in code, not in Markdown** (my suggestion): in prose, `->` and `##` are text and syntax, and the morphing is what surprised the tester; in code the ligatures stay. One CSS rule for Markdown editors (wiki, task descriptions, comments, `.md` in Code).
2. A setting **Font ligatures: on / in code only / off**, defaulting to "in code only".
3. Leave as is.

### Claude — 2026-10-14 04:15+02:00

Emanuel saw something else than the joined hashes: `##` stays `##`, but `###` shows as a blank and `##`, `####` as two blanks and `##`, and so on. Not reproduced in the web build (Chromium), where every count of hashes shows right, also at heading weight and a large size.

It matches how ligature fonts draw long sequences: the first characters become invisible spacer glyphs, and one wide glyph at the end reaches back over them. If that glyph is cut off or drawn only partly, the spacers show as blanks. That depends on the engine, the display scaling and the weight (heading marks are bold), so it may only show in some builds.

To confirm: the variant (Tauri, Electron, Deno), the OS and display scaling, and a screenshot. Option 1 above (no ligatures in Markdown) would remove it either way.

### Claude — 2026-10-14 15:05+02:00

Found and fixed (PR #8): a Chromium bug, not the fonts. While typing, Chromium reshapes only the edited part of a line, but a ligature depends on the characters around it. Reproduced in a plain `contenteditable` field without CodeMirror, while the same text set at once renders right, which is why it only showed while typing:

- JetBrains Mono turns the first characters into invisible spacers that a final wide glyph should cover; with the stale shaping that glyph is missing, so `<->` shows as a blank and `→`, `<-> ` as `>`, and `####` as two blanks and `##`.
- Fira Code and Cascadia Code keep the characters unjoined until the line is drawn again ("usable, but not perfect").

Fix: every edit flips a font setting of the editor that renders the same (kerning, on by default), which makes Chromium shape the lines afresh. Typing `<->`, `####` and `a -> b` key by key now shows the ligatures at every step, in all three fonts. Ligatures stay on, and the font and ligature settings remain for whoever prefers otherwise.
