---
id: GENBEYA-38
title: Order epics by a leading phase number
type: improvement
status: backlog
priority: medium
labels: [tasks]
---

Epics that start with a phase number (to get them in a certain order) are ordered alphabetically: 0, 1, 10, 2, 3, …

As a convention: if the epic's name starts with digits only, up to the first space, that part is read as an integer and orders the epic. Epics without such a prefix, and epics with the same number, are ordered alphabetically.

### Claude — 2026-10-20 14:41+02:00

Confirmed: `epicsOf` in `task-model.ts` sorts with `localeCompare`. A few other places sort epics with a plain `.sort()`: the epic picker in `task-properties.ts`, and `task-actions.ts` in the VS Code extension.

Plan:

- One comparator, `compareEpics`, next to `epicsOf`, used everywhere epics are listed: swimlanes, the epic filter and picker, the Tasks list grouped by epic, and the VS Code extension's tree and quick picks.
- `"10 Launch"` gets the number 10; `"10-Launch"`, `"v2 Beta"` and `"2024 Roadmap"` follow the rule as written (the last one is 2024).
- **Assumption:** numbered epics come first, by number, and the others follow alphabetically. **No epic** stays last.
