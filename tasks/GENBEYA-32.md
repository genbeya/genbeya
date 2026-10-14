---
id: GENBEYA-32
title: Link branches to tasks by the task ID in the branch name
type: feature
status: review
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

### Emanuel Knecht — 2026-10-14 01:35+02:00

sounds useful.. also, the thing with branch names mentioning tasks being linked to those tasks.. that was  indeed a useful bb feature.

### Claude — 2026-10-14 03:40+02:00

Done, parts 1 to 3 (task → branches, branch → task, create branch from a task):

- A task lists the local and remote branches whose name contains its ID, in any case and place (`GENBEYA-32-x`, `feature/genbeya-32`, not `GENBEYA-320`); a click switches to one, a remote-only one is checked out.
- **…** → **Create branch…** suggests `<ID>-<title-slug>` and switches to the new branch.
- The sidebar shows the task of the checked-out branch below the branch, linking to it.

Matching and naming are in `features/tasks/task-branches.ts`. Part 4 (commits naming a task) is left for later, as are ahead/behind counts per branch, which would need the snapshot to carry them.
