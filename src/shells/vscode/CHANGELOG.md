# Changelog

The extension is versioned with the Genbeya app; versions without a change to the extension are left out.

## 0.2.1

- **Plans over time**: pages draw `[BURNDOWN]` and `[BASELINE v1.0]` from the tasks' Git history, as in the app.
- Plans count the project's working days, holidays and dated milestones (the calendar in `.genbeya.yml`).
- Ticking a checkbox in a preview leaves the file alone if it changed since it was shown, and says so.
- Found on the Marketplace by its keywords: wiki, kanban, markdown, git.

## 0.2.0

- On the Visual Studio Marketplace, as **Genbeya for VS Code**.
- **Planning**: a task's preview edits effort fields (`16h`, `2d`) and the tasks it waits for. Pages draw the plan blocks: `[GANTT]`, `[DEPENDENCIES]`, `[ARROWS]`, `[EFFORT]` and `[FLOAT]`. Blocked tasks are marked in the Tasks view and on the board.
- **Pinned references**: `#L10-L20@v0.1.0` shows lines as they were in a tag or commit, and opens them read-only.
- **Board**: swimlanes without a card to show are left out, and epics named with a number first, such as `2 Build`, sort by it.
- The Wiki and Tasks views hide when the project doesn't use that part (`unused` in `.genbeya.yml`).
- A smaller package: the extension leaves out the app's terminal and its WSL and SSH connections, which VS Code has itself.

## 0.0.3

- On Open VSX.

## 0.0.2

The first release:

- **Wiki** and **Tasks** views: the page tree, and the tasks by workflow state or by epic. Drag tasks onto a state or an epic to move them; the context menu changes their properties.
- **Previews** of pages and tasks, rendered as in the app, one tab each. A task's properties, fields and comments can be changed there, and its activity is shown.
- **Board** with filters and swimlanes per epic.
- In VS Code's Markdown editor, `[[` completes tasks, pages and files, `@` people and `//` dates; references show their title and state on hover, open with Ctrl+click and are flagged when they point to nothing.
