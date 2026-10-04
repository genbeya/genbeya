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

## The board

- Drag cards between columns to change their status, or switch to the list layout.
- `C` creates a task. `/` filters by text; the filter button narrows by assignee, priority or label.
- Click a card to open it. Status, priority, assignee and labels change right away from the chips under the title. Checkboxes in the description can be ticked directly.
- `E` edits the title and description, `Ctrl+S` saves, `Esc` closes.

## Workflow states

The columns are the `statuses` in `.gitdesk.yml`, in order; the last one counts as done. Tasks in a state that is no longer configured appear in an extra column so nothing gets lost — move them into a configured state.
