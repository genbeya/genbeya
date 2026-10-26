---
id: GENBEYA-48
title: Time log on tasks
type: feature
status: in-progress
priority: medium
labels: [planning]
---

Effort spent is logged on the task, in a `## Time log` section above `## Comments`, one line per entry: `- 2026-10-21 — Alex — 2h — Investigated OAuth flow`. Together with the estimate and the remaining effort ([[GENBEYA-43]]) it gives the budget, what was spent and what is left. Done when **Log time** adds an entry (optionally updating `remaining`), the task shows logged effort, forecast and variance, unreadable lines are flagged, and the time log is off unless the project turns it on. See [[Design/Planning#the-time-log]].

Prototype on `feature/planning-prototype`: a `## Time log` section at the end of the description; **Log time** takes `2h What for`. Left: the project switch (effort shows once an effort field is configured), updating `remaining` in the same step, entries in the activity.

- [x] Decide: a section of its own, or an effort on a comment
- [ ] Document the line grammar once, shared with pull request replies and verdicts ([[GENBEYA-50]])
- [x] Task engine: parse and append entries, flag unreadable lines, keep the section's place next to the comments, with spec tests
- [x] Task panel: **Log time** (amount, note, optionally remaining), the entries, the sums
- [ ] Activity: added and changed entries
- [ ] Project switch for the time log ([[GENBEYA-39]]), off by default
- [x] Sums per task, epic and milestone only, never per person
- [x] Demo counterpart (none needed: no new manager calls), `npm run e2e:demo` passed in CI ([run 44](https://github.com/genbeya/genbeya/actions/runs/40315593535))
- [x] Document in [[Guide/Tasks]], including who can see the entries
