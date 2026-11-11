---
id: GENBEYA-52
title: Pull requests view
type: feature
status: backlog
priority: medium
labels: [pull-requests]
---

A **Pull requests** view: the list of pull requests, and a pull request with its description, its computed state, and the diff from target to source in the existing diff viewer, with review threads beside their lines. Done when a pull request can be opened from two branches, reviewed by selecting lines in the diff (new topic or new code range, optionally with a suggestion), replied to, and edited by hand like any file. See [[Design/Pull-requests#the-view]].

- [ ] **New pull request**: source, target, title, description, reviewers
- [ ] List, filtered by state, author and reviewer
- [ ] Pull request page: description, state, diff target…source
- [ ] Threads beside their lines; outdated code ranges marked ([[GENBEYA-42]])
- [ ] Select lines → new topic or code range; suggestion as an edit of the lines
- [ ] Reply, tick to-dos
- [ ] Keyboard and palette commands
- [ ] Demo counterpart, `npm run e2e:demo`
- [ ] Guide page
