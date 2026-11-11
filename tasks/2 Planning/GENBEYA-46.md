---
id: GENBEYA-46
title: Effort summary as a wiki macro
type: feature
status: backlog
priority: medium
labels: [planning, wiki]
---

`[EFFORT …]` on a wiki page shows estimate, logged, remaining, forecast and variance per task with totals, for the matching tasks. Done when the macro renders live, uses the filters of [[GENBEYA-45]], and says how many tasks lack an estimate or have unreadable time log lines instead of presenting a partial sum as precise. See [[Design/Planning#the-numbers]].

- [ ] Engine: the numbers per task and the totals, with spec tests (remaining is never estimate − logged)
- [ ] Renderer: a table, with totals per epic or milestone
- [ ] Missing and unreadable data shown as such
- [ ] Logged effort once [[GENBEYA-48]] is done; until then estimate and remaining
- [ ] VS Code preview
- [ ] Document in [[Guide/Wiki]]
