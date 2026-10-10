# Tasks

Each task is one Markdown file in the task folder, named after its ID:

```markdown
---
id: GENBEYA-12
title: Virtualize long lists
status: todo
priority: medium
assignee: alice
labels: [performance]
---

Render only visible rows in the file tree and history.

- [ ] File tree
- [ ] History
```

IDs are `PREFIX-number`; the prefix is set in **Settings**. Extra frontmatter fields and YAML comments survive edits made in GitDesk.

Reference a task anywhere in Markdown with `[[GENBEYA-12]]`: it shows the task's title and current state (see [[Wiki#references]]).

Task files change with the checked-out branch and are committed like code. To see the same board on every branch, keep the tasks on the shared [[Content branch]] (**Settings → Where content lives → Tasks**); every change is then committed there right away, while the wiki can stay with the code.

## The board

- Drag cards between columns to change their status, or switch to the list layout.
- `C` creates a task. `/` filters by text; the filter button narrows by assignee, priority or label.
- Click a card to open it. Status, priority, assignee and labels change right away from the chips under the title. Checkboxes in the description can be ticked directly.
- `E` edits the title and description, `Ctrl+S` saves, `Esc` closes.

## Comments

Below the description, **Comments** lists what people wrote about the task. Type in the box and press `Ctrl+Enter` (`Cmd+Enter` on macOS) to add a comment; Markdown and `[[references]]` work as in the description. Your own comments have buttons to edit and delete them.

Comments are signed with your Git name (`git config user.name`, or the name Git takes from your system account) and stored at the end of the task file, so they read well anywhere Markdown is shown:

```markdown
---
id: GENBEYA-12
title: Virtualize long lists
status: todo
---

Render only visible rows in the file tree and history.

## Comments

### Ada Lovelace — 2026-10-10 14:32+02:00

The history needs it most.

### Alan Turing — 2026-10-11 09:05+02:00

Agreed, see [[GENBEYA-14]].
```

- The comments start at the first `## Comments` heading that is followed by a comment heading: `### Name — date time`, with the time to the minute and the UTC offset.
- New comments go last, so comments written on two branches merge cleanly.
- Editing the description never changes the comments, and the other way round.
- A line in a description or comment that would read as a comment heading is saved with a leading `\`.

## Activity

**Activity**, next to Comments, shows who changed the task and when, from the Git history of its file: status, priority, assignee, title and epic with their old and new values, added and removed labels, description edits, and added, edited or deleted comments. It follows the task when it moves between epics, and lists the latest 100 commits; click a commit to open it in [[Version control#history|History]].

Changes saved but not committed yet come first, marked *Not committed yet*. When the tasks live on the [[Content branch]], every edit is committed right away, so the activity is always complete.

## Epics

An epic is a folder in the task folder: `tasks/Login rework/GENBEYA-14.md` belongs to the epic *Login rework*. Folders can nest (`Auth/Tokens`). IDs stay unique across epics.

- **Epic** under a task's title moves it into another epic, or into a new one; the file moves along.
- The swimlane button next to the layout switch shows one row per epic on the board. Dragging a card into another row moves it to that epic.
- The filter menu narrows the board and the list to one epic.

## Workflow states

The columns are the `statuses` in `.gitdesk.yml`, in order; the last one counts as done. To keep the board short, untick a state in the list layout: it disappears from the board for everyone (`hiddenColumns` in `.gitdesk.yml`) and stays in the list. Tasks in a state that is no longer configured appear in an extra column so nothing gets lost — move them into a configured state.
