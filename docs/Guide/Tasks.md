# Tasks

The **Tasks** view (`Ctrl+2`) shows the project's tasks on a board or in a list. Each task is one Markdown file in the task folder (`tasks/` unless **Settings** names another), named after its ID:

![The task board with one swimlane per epic, and task types as icons on the cards](../images/task-board.png)

[TOC]

## The task file

```markdown
---
id: GENBEYA-12
title: Virtualize long lists
type: improvement
status: todo
priority: medium
assignee: alice
labels: [performance]
---

Render only visible rows in the file tree and history.

- [ ] File tree
- [ ] History
```

- IDs are `PREFIX-number`; the prefix is set in **Settings** (`taskPrefix`). IDs stay unique across epics.
- `status` is one of the workflow states, `priority` is `urgent`, `high`, `medium` or `low` (none when left out), `type` one of the task types.
- Extra frontmatter fields and YAML comments survive edits made in Genbeya; configure them as [custom fields](#custom-fields) to edit them in Genbeya too.

Write `[[GENBEYA-12]]` in a page, a description or a comment to show the task's title and current status anywhere; a plain `GENBEYA-12` links too. See [References](References.md).

Task files change with the checked-out branch and are committed like code. To see the same board on every branch, keep the tasks on the shared [Content branch](../Architecture/Content-branch.md) (**Settings → Where content lives → Tasks**); every change is then committed there right away, while the wiki can stay with the code.

## The board

- Drag cards between columns to change their status. **Board** and **List** switch the layout; the list shows every task, including those in hidden columns.
- `C` (or **New task**) creates a task, `+` at the top of a column creates one in that column.
- `/` filters by text; **Filter by** narrows the board and the list to a type, an epic, an assignee, a priority or a label.
- A card shows the task's type, ID, title, assignee, priority, labels and date fields, overdue ones in red.

## The task panel

Click a card to open the task beside the board.

![A task with its properties, a checklist, references and two comments](../images/task-panel.png)

- Status, type, priority, assignee, epic and labels change right away from the chips under the title; custom fields sit below them. **Assignee** offers the repository's people — see [Writing pages](Writing.md#assignees).
- Checkboxes in the description can be ticked without editing.
- `E` (or **Edit**) edits the title and description, with `[[` completion for [References](References.md). `Ctrl+S` or `Ctrl+Enter` saves, `Esc` cancels, and `Esc` again closes the panel.
- The `…` menu copies links to the task (see [Sharing](Sharing.md)), creates a branch for it (see [Branches of a task](#branches-of-a-task)) and deletes it.

## Branches of a task

A branch whose name contains a task's ID belongs to that task, as in Jira and Bitbucket: `GENBEYA-32-branch-links`, `feature/genbeya-32` (any case, anywhere in the name).

- The task lists its branches below its properties; click one to switch to it (a branch only on a remote is checked out). The checked-out one is highlighted.
- **…** → **Create branch…** offers a name made of the ID and the title, such as `GENBEYA-32-link-branches-to-tasks`, and switches to the new branch.
- Below the branch in the sidebar, the task of the checked-out branch is shown; click it to open the task.

## Comments

Below the description, **Comments** lists what people wrote about the task. Type in the box and press `Ctrl+Enter` (`⌘Enter` on macOS) to add a comment. Markdown, `[[references]]`, `@mentions` and dates work as in the description; the box completes `@` and `//` (see [Writing pages](Writing.md)) but not `[[`, so type references in full. Your own comments have buttons to edit and delete them.

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

**Activity**, next to Comments, shows who changed the task and when, from the Git history of its file: status, type, priority, assignee, title, epic and custom fields with their old and new values, added and removed labels, description edits, and added, edited or deleted comments. It follows the task when it moves between epics, and lists the latest 100 commits; click a commit to open it in [History](Version-control.md#history).

Changes saved but not committed yet come first, marked *Not committed yet*. When the tasks live on the [Content branch](../Architecture/Content-branch.md), every edit is committed right away, so the activity is always complete.

## Epics

An epic is a folder in the task folder: `tasks/Login rework/GENBEYA-14.md` belongs to the epic *Login rework*. Folders can nest (`Auth/Tokens`). IDs stay unique across epics.

- **Epic** under a task's title moves it into another epic, or into a new one; the file moves along.
- **Swimlanes by epic**, next to the layout switch, shows one row per epic on the board. Dragging a card into another row moves it to that epic. Rows without a card to show, because of a filter or hidden columns, are left out; so is **No epic** when every task has one.
- **Filter by** narrows the board and the list to one epic.
- Epics are listed alphabetically, except that a name starting with a number and a space, such as `1 Discovery` or `10 Launch`, is ordered by that number, before the others: `2 Build` comes before `10 Launch`. Tasks without an epic come last.

## Workflow states

The board's columns are the workflow states, set in **Settings → Workflow** (`statuses` in `.genbeya.yml`), in order; the last one counts as done. To keep the board short, untick a state in the list layout: it disappears from the board for everyone (`hiddenColumns` in `.genbeya.yml`) and stays in the list. Tasks in a state that is no longer configured appear in an extra column so nothing gets lost — move them into a configured state.

### Column icons

A state shows a ring that fills as work advances, and a check for the last one. To give a column its own icon, pick one next to the state in **Settings → Workflow**. In `.genbeya.yml` such a state is written as a name with an icon; states without one stay plain names:

```yaml
statuses:
  - todo
  - name: in-progress
    icon: play
  - name: done
    icon: flag
```

## Types

A task can have a type, such as bug or feature: its icon shows on the card, in the list and under the title, where **Type** changes it. **Filter by** narrows the board to one type. Without `types` in `.genbeya.yml`, the types are bug, feature, improvement and chore. Configure your own in **Settings → Task types**, with an icon and an optional colour each:

```yaml
types:
  - name: bug
    icon: bug
    tone: red         # gray, blue, green, yellow, orange, red or purple
  - name: spike
    icon: flask-conical
  - feature           # a name alone brings its usual icon and colour
```

A list of names, such as `types: [bug, feature]`, works too: well-known names (bug, feature, improvement, chore, task, story, docs, question, research) get their usual icon, others a generic one. A task whose type is not configured keeps it and shows the generic icon. `types: []` turns types off.

### Templates

Choosing a type for a new task fills its description from the type's template, a Markdown file in the task folder named after the type: `tasks/.templates/bug.md`. Frontmatter in the template presets the new task's priority, assignee, labels and custom fields, unless you set them already:

```markdown
---
priority: high
labels: [bug]
---

## Steps to reproduce

## Expected

## Actual
```

The template button next to a type in **Settings → Task types** opens its template in **Code**, and creates it first if there is none. Templates live with the tasks: when the tasks are on the [Content branch](../Architecture/Content-branch.md), the button names the file there instead, since **Code** shows the checkout. Folders in the task folder whose names start with a dot hold no tasks, so `.templates` is no epic.

## Custom fields

Fields that every task of the project should have, such as an estimate or a due date, are configured in **Settings → Custom fields**, or as `fields` in `.genbeya.yml`:

```yaml
fields:
  - name: estimate
    type: number
  - name: due
    type: date        # written as 2026-05-01
  - name: area
    type: choice
    options: [ui, backend, docs]
  - name: reviewer    # text, unless a type is given
```

They appear under a task's properties and are saved to its frontmatter as you change them; emptying a field removes it from the file. Names start with a letter and use letters, digits, `-` and `_`; Genbeya's own keys (id, title, type, status, priority, assignee, labels, epic) are taken. Field types are `text`, `number`, `date`, `choice`, `effort` (hours or days of work, such as `16h` or `2d`) and `tasks` (task IDs, saved as a list). Some names plan: see [Planning](#planning). Other frontmatter fields of a task show below the configured ones, read-only, and are never lost: removing a field from the settings leaves the values in the task files.

Every key of `.genbeya.yml` is described in [Settings](Settings.md).

## Planning

> [!NOTE]
> A first version, to try out: see [Planning](../Design/Planning.md) for where it is heading.

Fields with these names plan, once they are configured as [custom fields](#custom-fields):

```yaml
fields:
  - name: estimate      # the effort budgeted
    type: effort
  - name: remaining     # the effort still needed, kept up to date while working
    type: effort
  - name: depends_on    # tasks that must be done before this one can start
    type: tasks
  - name: duration      # how long it takes: for the critical path
    type: effort
  - name: start         # for the timeline
    type: date
  - name: due
    type: date
  - name: milestone     # for filters
    type: choice
    options: [MVP, 1.0]
```

Effort is written in hours or days, `16h` or `2d`; a day counts as 8 hours. Nothing is computed into the files: every sum is worked out from them when shown.

### Effort and the time log

A task with effort shows five numbers under its fields:

| Number | Means |
| --- | --- |
| **Estimate** | The `estimate` field: what was budgeted |
| **Logged** | What the task's time log adds up to: what was spent |
| **Remaining** | The `remaining` field: what is left. A task in the last state needs none |
| **Forecast** | Logged + remaining: where the task will land |
| **Variance** | Forecast − estimate: over the budget in orange, under it in green |

Remaining is never worked out from the estimate: update it when you learn more.

**Log time** asks for the time spent and what for, such as `2h Reviewed the token validation`, and adds a line to the task's time log, a `## Time log` section at the end of its description, signed with your Git name like comments:

```markdown
## Time log

- 2026-10-21 — Alex Chen — 2h — Investigated the OAuth flow
- 2026-10-22 — Alex Chen — 3h — Implemented token validation
```

Edit the lines like any text to correct them. A list item in the section that doesn't read as an entry is pointed out, and left out of the sums. The time log is in the repository: everyone who can read it sees the entries.

### Dependencies

`depends_on` lists the tasks that must be done first. Type their IDs separated by commas; they are saved as a list.

- A task whose dependencies aren't all done is **blocked**: its card shows a lock, with what it waits for as the tooltip.
- The task shows what it is **Blocked by** (or **Waits for**, once they are done) and what it **Blocks**, as references with their states.
- A dependency on a task that doesn't exist, on the task itself, or in a cycle is pointed out on the task.

### Critical path and float

Genbeya works out the critical path over the unfinished tasks, in days from today:

- **How long a task takes** is its `duration`, else its `start` to `due` (both days counted), else its remaining effort or its estimate at 8 hours a day. Finished tasks are left out, so what waits only for them can start today.
- **Float** (slack) is how long a task can slip without delaying the end; **free float** how long before a task waiting for it is delayed. Tasks without float are on the **critical path**.
- The task shows its float, or that it is on the critical path, with when it starts at the earliest and the latest.
- A task with no duration, dates or effort counts as taking no time; tasks in a cycle are left out. Both are pointed out.

### Plans in the wiki

Three blocks on any wiki page show the plan, worked out from the tasks whenever the page is shown — see [Wiki](Wiki.md#plans):

- `[EFFORT]`: estimate, logged, remaining, forecast and variance per task, with totals.
- `[DEPENDENCIES]`: what waits for what, as a diagram.
- `[GANTT]`: the tasks with a `due` date on a timeline, from their `start`; a task with only a due date is a milestone.
- `[ARROWS]`: the critical path as an arrow diagram, each task an arrow with its duration and float.
- `[FLOAT]`: the critical path as a table, with each task's earliest and latest start and finish and its float.
