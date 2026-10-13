---
id: GENBEYA-30
title: The wiki's Save button doesn't show whether there is anything to save
type: bug
status: backlog
priority: low
labels: [feedback, wiki]
---

Reported by a tester:

> In Code when I press Ctrl+S the purple button becomes grey. In Wiki not.

To reproduce: edit a wiki page, change something, press `Ctrl+S`: the page is saved, but **Save** stays purple. Do the same with a file in **Code**: **Save** turns grey.

## Comments

### Claude — 2026-10-14 00:40+02:00

**Triage: fix, after a small decision.** Reproduced in the web demo; `Ctrl+S` does save (the Changes count went up), only the button doesn't show it.

Cause: in Code the button follows the unsaved state (`btn-primary` and enabled only while dirty, `features/code/file-editor.ts`); in the wiki it is always `btn-primary` (`features/wiki/wiki-page.ts`). The two buttons also do different things: in Code, Save only saves; in the wiki, the button saves *and closes the editor* (`save(true)`), while `Ctrl+S` saves and stays (`save(false)`).

To decide, what the wiki's button shows when nothing is unsaved:

- **Done** in the default style, closing the editor; **Save** in purple only while there are changes. (My suggestion: it keeps the one-click way out and reads like the state.)
- Grey and disabled, as in Code; leaving the editor is then only **Cancel**.
