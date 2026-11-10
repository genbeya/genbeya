---
id: GENBEYA-50
title: Pull request file format
type: feature
status: backlog
priority: medium
labels: [pull-requests]
---

One Markdown file per pull request: frontmatter (`id`, `title`, `status`, `author`, `source`, `target`, `reviewers`, `merge_commit`), a description, `## Review` with topics and code ranges (pinned references, [[GENBEYA-42]]), `diff` suggestions, to-dos and replies, and `## Discussion` with replies and verdicts. Nothing derived is written into the file. Done when the format is documented and an engine reads and writes it, flagging lines it can't read. See [[Design/Pull-requests#the-file]].

- [ ] Decide the line grammar for replies and verdicts, time zones included, documented once with the time log's ([[GENBEYA-48]])
- [ ] Decide the IDs: `PR-7` with its own counter, or the task prefix
- [ ] Pull request engine: parse and write the file (topics, code ranges, suggestions, to-dos, replies, verdicts), with spec tests
- [ ] Unreadable lines flagged, never dropped
- [ ] An example pull request in the sample repository
- [ ] Teach the agent skill the format
- [ ] Document the format (Guide page, once built)
