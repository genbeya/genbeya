---
id: GENBEYA-67
title: Keep a repository from GitHub in the browser, by choice
type: feature
status: review
priority: medium
labels: [integrations, github, web, privacy]
---

Genbeya on GitHub ([[GENBEYA-66]]) keeps everything in the tab's memory. Let visitors choose to keep a repository, with their changes, in the browser's private file storage (OPFS), so it survives a reload and opens again without asking GitHub. Design: [[Architecture/Forges#keeping-a-repository]].

Off by default and a choice of its own, never bundled with agreeing to the requests. Nothing kept ever leaves the device, and deleting it is as easy as keeping it.

- [x] Save and restore the whole in-memory repository: commits, index, working tree, branches, tags, stashes, an operation in progress
- [x] Store kept repositories in OPFS, asking the browser not to evict them; tokens are never kept
- [x] The notice: an unticked "Keep it in this browser", and a kept copy that opens without any request
- [x] Save after every change; one tab per kept repository (Web Locks)
- [x] The badge: keep, or delete the kept copy; the notice: delete everything kept
- [x] Unit and end-to-end tests, including that a kept copy opens with no request
