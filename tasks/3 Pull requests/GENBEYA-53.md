---
id: GENBEYA-53
title: Verdicts and which approvals still count
type: feature
status: in-progress
priority: medium
labels: [pull-requests]
---

Request review, approve, request changes and withdraw, each written as a reply that names the revision, and Genbeya computes which approvals are still effective: an approval stays valid while the change it approved is the change to merge (`patch-id` of merge base to head), commits touching only the pull request file don't matter, and code changes make it stale. Done when the pull request shows effective, stale and withdrawn approvals and open change requests, and says when a verdict was committed by someone else. See [[Design/Pull-requests#verdicts]] and [[Design/Pull-requests#which-approvals-still-count]].

Prototype on `feature/pull-requests`: `versionControl.compare` gives the change ID (a hash of the diff from the merge base without positions, not `patch-id`, which needs stdin); `approvalsOf` in `src/utilities/pull-requests.ts` decides. Left: comparing a verdict with the author of its commit.

- [x] Verdict buttons appending to the file
- [x] Effective approvals: compare the change, through rebases; in the checkout, leave out the pull request folder
- [x] The pull request folder holds only pull request files
- [ ] Recorded, not verified: compare the verdict's name with the author of the commit that added it
- [x] Project policy: number of approvals needed
- [x] Spec tests for the approval rules, including rebases and review-only commits, on both areas
- [x] Demo counterpart, `npm run e2e:demo`
