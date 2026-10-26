---
id: GENBEYA-56
title: Show a task's pull requests
type: feature
status: backlog
priority: low
labels: [pull-requests, tasks]
---

Tasks already find their branches by the ID in the branch name. In the same way, a task shows the pull requests whose source branch is one of its branches, or that reference it, with their state ("open into develop, 1 of 2 approvals"), and a pull request shows its tasks. Done when both directions show and link. See [[Design/Pull-requests#pull-requests-and-tasks]].

- [ ] Task panel: pull requests of the task, with state
- [ ] Pull request: its tasks, as references
- [ ] Board card: a mark for an open pull request
- [ ] Demo counterpart, `npm run e2e:demo`
- [ ] Document in [[Guide/Tasks]]
