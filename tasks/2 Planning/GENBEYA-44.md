---
id: GENBEYA-44
title: Task dependencies
type: feature
status: in-progress
priority: medium
labels: [planning]
---

`depends_on` lists the tasks that must be done before a task can start. Done when dependencies can be edited in the task panel, are checked (unknown IDs, a task depending on itself, cycles), and a task shows what it waits for and what it blocks, with blocked and ready tasks visible on the board. See [[Design/Planning#dependencies]].

Prototype on `feature/planning-prototype`: `tasks` fields hold lists of task IDs; the rules are in `src/utilities/planning.ts`. Left: blocked marks in VS Code's tree and board.

- [x] Task list field kind: task IDs shown as references, with completion
- [x] Task engine: dependencies, the reverse "blocks", and the checks, with spec tests
- [x] Task panel: waits for, blocks, problems
- [x] Board and list: blocked and ready marks
- [ ] VS Code extension: the same marks in its tree and board
- [ ] Demo counterpart, `npm run e2e:demo`
- [x] Document in [[Guide/Tasks]]
