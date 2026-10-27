---
id: GENBEYA-52
title: Pull requests view
type: feature
status: in-progress
priority: medium
labels: [pull-requests]
---

A **Pull requests** view: the list of pull requests, and a pull request with its description, its computed state, and the diff from target to source in the existing diff viewer, with review threads beside their lines. Done when a pull request can be opened from two branches, reviewed by selecting lines in the diff (new topic or new code range, optionally with a suggestion), replied to, and edited by hand like any file. See [[Design/Pull-requests#the-view]].

Prototype on `feature/pull-requests`: the **Pull requests** view (`Ctrl+6`), `src/client/app/features/pulls/`. Comments go on changed lines; outdated means written at an older revision. Left: keyboard shortcuts within the view, comments on unchanged lines.

- [x] **New pull request**: source, target, title, description, reviewers
- [x] List, filtered by state, author and reviewer
- [x] Pull request page: description, state, diff target…source
- [ ] Threads beside their lines; outdated code ranges marked ([[GENBEYA-42]])
- [x] Select lines → new topic or code range; suggestion as an edit of the lines
- [x] Reply, tick to-dos
- [ ] Keyboard and palette commands
- [x] Demo counterpart, `npm run e2e:demo`
- [x] Guide page
