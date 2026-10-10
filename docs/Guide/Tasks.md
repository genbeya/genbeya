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

IDs are `PREFIX-number`; the prefix is set in **Settings**. Extra frontmatter fields and comments survive edits made in GitDesk.

Reference a task anywhere in Markdown with `[[GENBEYA-12]]`: it shows the task's title and current state (see [[Wiki#references]]).

Task files change with the checked-out branch and are committed like code. To see the same board on every branch, keep the tasks on the shared [[Content branch]] (**Settings → Where content lives → Tasks**); every change is then committed there right away, while the wiki can stay with the code.

## The board

- Drag cards between columns to change their status, or switch to the list layout.
- `C` creates a task. `/` filters by text; the filter button narrows by assignee, priority or label.
- Click a card to open it. Status, priority, assignee and labels change right away from the chips under the title. Checkboxes in the description can be ticked directly.
- `E` edits the title and description, `Ctrl+S` saves, `Esc` closes.

## Epics

An epic is a folder in the task folder: `tasks/Login rework/GENBEYA-14.md` belongs to the epic *Login rework*. Folders can nest (`Auth/Tokens`). IDs stay unique across epics.

- **Epic** under a task's title moves it into another epic, or into a new one; the file moves along.
- The swimlane button next to the layout switch shows one row per epic on the board. Dragging a card into another row moves it to that epic.
- The filter menu narrows the board and the list to one epic.

## Workflow states

The columns are the `statuses` in `.gitdesk.yml`, in order; the last one counts as done. To keep the board short, untick a state in the list layout: it disappears from the board for everyone (`hiddenColumns` in `.gitdesk.yml`) and stays in the list. Tasks in a state that is no longer configured appear in an extra column so nothing gets lost — move them into a configured state.
