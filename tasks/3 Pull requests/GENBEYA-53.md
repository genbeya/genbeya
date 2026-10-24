---
id: GENBEYA-53
title: Verdicts and which approvals still count
type: feature
status: backlog
priority: medium
labels: [pull-requests]
---

Request review, approve, request changes and withdraw, each written as a reply that names the revision, and Genbeya computes which approvals are still effective: an approval stays valid while the change it approved is the change to merge (`patch-id` of merge base to head), commits touching only the pull request file don't matter, and code changes make it stale. Done when the pull request shows effective, stale and withdrawn approvals and open change requests, and says when a verdict was committed by someone else. See [[Design/Pull-requests#verdicts]] and [[Design/Pull-requests#which-approvals-still-count]].

- [ ] Verdict buttons appending to the file
- [ ] Effective approvals: compare the change, through rebases; in the checkout, leave out the pull request folder
- [ ] The pull request folder holds only pull request files
- [ ] Recorded, not verified: compare the verdict's name with the author of the commit that added it
- [ ] Project policy: number of approvals needed
- [ ] Spec tests for the approval rules, including rebases and review-only commits, on both areas
- [ ] Demo counterpart, `npm run e2e:demo`
