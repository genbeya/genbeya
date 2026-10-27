---
id: GENBEYA-54
title: Ready to merge, and merging a pull request
type: feature
status: in-progress
priority: medium
labels: [pull-requests]
---

A pull request shows each gate separately: approvals ([[GENBEYA-53]]), open to-dos, conflicts (checked with `git merge-tree` without touching the checkout), uncommitted changes. It advises; it can't enforce. Done when the gates are shown, **Merge** merges with the existing merge operations, and the file records `status: merged` and `merge_commit`. See [[Design/Pull-requests#ready-to-merge]].

Prototype on `feature/pull-requests`: `gatesOf` lists the conditions; **Merge** switches to the target and merges with a merge commit, then records it; **Mark merged** for merges finished elsewhere. Left: whether open to-dos block, squash and rebase merges.

- [x] Gates computed, never written into the file
- [x] Conflict check without touching the checkout (needs Git 2.38 for `merge-tree --write-tree`; fall back or say so on older Git)
- [ ] Project policy: whether open to-dos block
- [x] Merge, then record the outcome
- [ ] Decide how squash and rebase merges compare with the approved change
- [x] Demo counterpart, `npm run e2e:demo`
