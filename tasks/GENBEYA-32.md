---
id: GENBEYA-32
title: Link branches to tasks by the task ID in the branch name
type: feature
status: backlog
priority: low
labels: [feedback, git, idea]
---

Suggested by a tester:

> A feature I like in Bitbucket is that I could put the name of the Jira task into the branch name, and then looking at the task always led to the branch. Just an idea.

## Comments

### Claude — 2026-10-14 00:40+02:00

**Triage: decide first.** Not a bug; Genbeya has nothing like it yet. Tasks show their own file's history (activity), and references already turn task IDs in text into links.

What it could be, building on what exists:

1. **Task → branches:** a task's panel lists local and remote branches whose name contains its ID (`GENBEYA-32-branch-links`, `feature/GENBEYA-32`), with ahead/behind and a switch button. Matching is by the configured prefix, so it needs no settings.
2. **Branch → task:** the branch in the sidebar and in **Changes** shows the task its name contains, as a reference with title and state.
3. **Create branch from a task:** a "Create branch" action that names it `<ID>-<title-slug>`.
4. Later, the same for commit messages that name the task (task IDs in rendered text are links already).

To decide: whether we want this, and which part first. I'd start with 1 and 3: small, local, no new settings. It fits the forge plugins on the roadmap too (pull requests naming the task).
