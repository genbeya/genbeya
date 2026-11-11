---
id: GENBEYA-55
title: Clean up a pull request into tasks and pages
type: feature
status: backlog
priority: medium
labels: [pull-requests]
---

Before the merge, Genbeya walks through what is still open: each to-do or topic is resolved, dismissed with a reason, or promoted to a new task or a wiki page and replaced by a reference to it. Verdicts are never removed. Done when the cleanup leaves a short record with references to its follow-ups, and the full discussion stays in Git. See [[Design/Pull-requests#cleaning-up]].

- [ ] Open items listed: to-dos and topics without an outcome
- [ ] Resolve, dismiss with a reason, promote to a task (prefilled) or to a page section
- [ ] Shorten a topic to its outcome
- [ ] Never remove verdicts
- [ ] Say when a squash merge in the checkout would drop the discussion's history
- [ ] Demo counterpart, `npm run e2e:demo`
