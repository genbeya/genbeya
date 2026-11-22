---
id: GENBEYA-33
title: Hide empty swimlanes
type: improvement
status: review
priority: low
labels:
  - idea
---

If a swimlane is empty (because of filtering or hiding columns) it should not show up.

### Claude — 2026-10-20 14:15+02:00

Confirmed. The board's lanes come from all tasks (`lanesOf(snapshot.tasks)` in `tasks-view.ts`), not from the cards it shows, so filters and hidden columns leave empty lanes. Also, the **No epic** lane is always there, even when every task has an epic.

Plan:

- Show a lane only if it has a card in a visible column after filtering. That applies to **No epic** too.
- Keep the lanes fixed while a card is dragged, so dragging the last card out of a lane doesn't remove the lane under the pointer.
- The lane count only counts cards in visible columns. Today it also counts cards in hidden columns.

A side effect: a hidden lane is no longer a drop target, so you can't drag a card into an epic that has no visible cards. Changing the task's epic in its panel still does that. Small change, mostly in `task-board.ts` and `tasks-view.ts`, with a spec.

### Claude — 2026-10-20 15:45+02:00

Done, on the desktop board and in the VS Code board. A lane shows only when it has a card in a visible column after filtering, and **No epic** only when a shown task has no epic (`shownLanesOf` in `task-model.ts`). Lane counts leave out cards in hidden columns. Lanes only change on a drop, never during a drag, so no extra handling was needed there. Checked in the web demo with a text filter.
