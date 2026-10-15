---
id: GENBEYA-28
title: Views forget the open page, task or file when you switch away and back
type: improvement
status: review
priority: high
labels: [feedback, navigation]
---

Reported by a tester (translated from German):

> When I have a page open in the wiki and go to Tasks "briefly" and back, it would be nice if the same wiki page were still open, so I don't have to look for it again.

To reproduce: open a wiki page other than Home, click **Tasks** in the sidebar, click **Wiki** again: Home is shown.

## Comments

### Claude — 2026-10-14 00:40+02:00

**Triage: fix.** Reproduced in the web demo, and it is not only the wiki:

| View | Open before | After switching away and back |
| --- | --- | --- |
| Wiki | `docs/Where-files-live.md` | Home |
| Tasks | task `PW-2` open in the panel | no task open |
| Code | `README.md` | no file open |

Cause: the sidebar links and `Ctrl+1` … `Ctrl+5` go to `/wiki`, `/tasks` and `/code` without the query (`page`, `task`, `file`) that says what was open (`src/client/app/features/shell/sidebar.html`); the wiki then opens its first page (`WikiView`'s `firstPage` effect).

Plan: remember each view's last URL for the open repository in the session (in memory), and let the sidebar links and their shortcuts return there. Forget a remembered page, task or file when it is deleted or moved, and when the repository changes. Back and forward keep working as now.

To decide: should the views also come back after restarting the app (saved in the preferences, like the last repository)? I'd start with the session only.

### Emanuel Knecht — 2026-10-14 01:25+02:00

no persistencem session only

### Claude — 2026-10-14 01:50+02:00

Done, session only: `ViewMemory` (`features/shell/view-memory.ts`) remembers where each view was left, per repository, and the sidebar links, `Ctrl+1` … `Ctrl+5` and the palette's view commands return there. One-off parameters (a line to scroll to, a new task) are not remembered, and a page, task or file that is gone since is left out. Checked in the web demo for the wiki, tasks and code.
