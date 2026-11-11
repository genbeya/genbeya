---
id: GENBEYA-47
title: Timeline as a wiki macro
type: feature
status: backlog
priority: low
labels: [planning, wiki]
---

`[GANTT …]` on a wiki page shows the matching tasks with `start` and `due` as a Mermaid timeline, with their dependencies, and marks conflicts: a task that starts before a task it depends on is due, a task due after its milestone. Dates are only ever set by people. Done when the macro renders live with the filters of [[GENBEYA-45]] and lists tasks without dates. See [[Design/Planning#dates-and-the-timeline]].

- [ ] Engine: tasks to a Mermaid Gantt chart, conflicts, with spec tests
- [ ] Renderer, clickable tasks
- [ ] Milestones as points in time, once [[GENBEYA-43]] decides what a milestone is
- [ ] VS Code preview
- [ ] Document in [[Guide/Wiki]]
