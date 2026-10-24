---
id: GENBEYA-49
title: Plan history and baselines from Git
type: feature
status: backlog
priority: low
labels: [planning]
---

Git keeps every version of every task, so the plan's history can be derived: remaining effort over time per epic or milestone, and what changed since a baseline (a tag or commit the team agreed on): tasks added, estimates raised, dates moved, dependencies added, each with its commit and author. Done when a wiki macro or the effort summary ([[GENBEYA-46]]) can show both. See [[Design/Planning#plan-history-and-baselines]].

- [ ] Extend the task activity engine from one task to all tasks, efficiently
- [ ] Burn chart: remaining over time, with logged effort ([[GENBEYA-48]])
- [ ] Comparison with a baseline, explaining why a forecast moved
- [ ] Say how precise it is: commits only, so the content branch is more precise than the checkout
- [ ] Demo counterpart, `npm run e2e:demo`
- [ ] Document in [[Guide/Tasks]] or [[Guide/Wiki]]
