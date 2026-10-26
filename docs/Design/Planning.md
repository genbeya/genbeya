# Planning

> [!NOTE]
> A first prototype is built ([[GENBEYA-43]] to [[GENBEYA-48]]); see [The prototype](#the-prototype) for what it does and what is left. How to use it: [Planning](../Guide/Tasks.md#planning).

Planning and controlling on top of the tasks: what work was budgeted, what it has cost, what is left, what blocks what, and where the plan is heading. The task files stay the only plan; every chart and sum is derived from them and from their Git history.

**Decided:**

- Estimate, remaining and logged effort are three different numbers, and all three are wanted. Together they make a controlling tool: the budget, what was spent, and what is left.
- Logged effort can't be derived from Git: the history says when a task changed, not how much work went into it. So effort is logged, in a time log.
- Planning is an [optional part](Optional-parts.md), and so is the time log.

[TOC]

## The prototype

What the first version answers, to try out before deciding for good:

- **Effort** is a field type of its own, `effort`: hours or days (`16h`, `2d`, a day being 8 hours), or a number of hours. Sums are shown in hours. There is no project unit yet.
- **Task lists** are a field type too, `tasks`, saved as a YAML list; custom field values may now be lists of texts.
- **Milestones** are a field value (`milestone`), used by filters; they have no date of their own yet.
- **The time log** is a section of its own at the end of the description, as below. **Log time** takes one line, `2h What for`, and signs it with the Git name.
- **Macros** are `[EFFORT]`, `[DEPENDENCIES]` and `[GANTT]`, filtered with `key=value` (`epic`, `milestone`, `assignee`, `label`, `type`, `status`).
- **Where it lives:** the rules are pure functions in `src/utilities/planning.ts`, shared by the app, its Markdown and VS Code. Nothing new on the backend: logging time is an edit of the description.
- **Critical path and float** ([[GENBEYA-65]]): durations from a `duration` field, else the dates, else the effort at 8 hours a day; days count from today, without a calendar. `[ARROWS]` draws it as an arrow diagram (activity on arrow), `[FLOAT]` as a table, and each task shows its float.
- **The sample project** plans: effort, time logs, a blocked task and a *Release plan* page.
- **Demo tasks** in this repository, the *Planning demo* epic with the milestone `DEMO`, try everything: see [[Planning demo]]. They go once planning is tested.

Left for later:

- Turning planning and the time log off ([Optional parts](Optional-parts.md)). For now effort shows once the project configures an `effort` field, or a task has a time log.
- Diagram nodes that open their task (the diagrams are pictures today), and blocked marks in VS Code's tree and board.
- Updating `remaining` while logging time, a project unit for effort, dated milestones.
- A calendar of working days for the critical path, and critical tasks marked on the timeline and the board.
- Plan history and baselines ([[GENBEYA-49]]).

## The numbers

| Number | Answers | Where it comes from |
| --- | --- | --- |
| **Estimate** | What did we budget? | The `estimate` field, set when the work is planned |
| **Logged** | What have we spent? | The sum of the task's time log |
| **Remaining** | What do we think is left? | The `remaining` field, updated by whoever works on the task |
| **Forecast** | Where will we land? | Logged + remaining |
| **Variance** | How far off the budget is that? | Forecast − estimate |

Remaining is never computed as estimate − logged: discoveries make work grow or shrink. The numbers add up across an epic or a milestone, which is where they are most useful.

## Task fields

Planning adds no new kind of file. It uses [custom fields](../Guide/Tasks.md#custom-fields) with well-known names, just as well-known type names bring their own icons:

```markdown
---
id: GENBEYA-42
title: Implement authentication
status: in-progress
assignee: alex
depends_on: [GENBEYA-38]
estimate: 16h
remaining: 6h
start: 2026-11-02
due: 2026-11-10
milestone: MVP
---
```

| Field | Kind | Means |
| --- | --- | --- |
| `estimate` | effort | The original budget |
| `remaining` | effort | The effort still needed |
| `start`, `due` | date | When the work is planned to start and to be done |
| `milestone` | choice or text | The milestone the task counts towards |
| `depends_on` | list of task IDs | Tasks that must be done before this one can start |
| `duration` | effort | How long the task takes, for the critical path |

Configured under these names, the fields take on their planning meaning; no mapping in the settings. Two kinds are new:

- **Effort:** an amount with the project's unit, such as `16h` or `2d`. The project picks one unit for estimates, remaining effort and the time log, since sums of mixed units mean nothing. Story points or rough sizes are not effort and stay ordinary fields.
- **Task list:** task IDs, shown as references with title and state, with completion from the task's IDs.

## Dependencies

`depends_on` lists blockers, read as finish-to-start: a task can start once the tasks it depends on are done.

- **Checked:** unknown IDs, a task depending on itself, and cycles are flagged on the task.
- **Shown:** a task shows what it waits for and, the other way round, what it blocks. A blocked task is marked on the board; a task whose blockers are all done counts as ready.
- **Separate from references:** `[[GENBEYA-12]]` in a description stays a plain link; only `depends_on` blocks.

The dependency graph is useful before anyone estimates anything, so it comes first.

## Plans as wiki macros

The views of a plan are not new screens. They are blocks on ordinary wiki pages, like `[TOC]` and `[SUBPAGES]` today, computed live from the tasks and drawn with the Mermaid renderer the wiki already has:

| Macro | Shows |
| --- | --- |
| `[DEPENDENCIES epic="2 Planning"]` | The dependency graph of the matching tasks; a click on a task opens it |
| `[EFFORT milestone=MVP]` | Estimate, logged, remaining, forecast and variance per task, with totals |
| `[GANTT milestone=MVP]` | The tasks with dates as a timeline, dependencies included, conflicts marked |

- A plan is then a page: the release plan, a milestone report, the roadmap, with text around the numbers.
- Nothing is stored twice: the page holds the macro, the tasks hold the data.
- It works wherever pages render, the VS Code preview included, without a new view or a new manager call.
- Filters use the same words as the board's **Filter by**: epic, milestone, assignee, label, type.
- Where data is missing (tasks without an estimate, without dates), the macro says how much is missing rather than presenting a partial sum as precise.

## Dates and the timeline

Dates are set by people. The timeline shows them and marks conflicts, such as a task that starts before a task it depends on is due, or one that is due after its milestone. Genbeya never moves dates by itself.

The critical path and float come from durations, which are not effort: a `duration` field, else a task's dates, else its effort at 8 hours a day. Calculated scheduling (dates proposed from durations, calendars and capacity) turns Genbeya into a scheduling tool and stays out until people ask for it.

## The time log

Effort is logged on the task, in a `## Time log` section above `## Comments`:

```markdown
## Time log

- 2026-10-21 — Alex — 2h — Investigated OAuth flow
- 2026-10-22 — Alex — 3h — Implemented token validation
- 2026-10-23 — Sam — 1.5h — Added integration tests
```

- **A line** is the date, the name as in comments (the Git name), the effort in the project's unit, and an optional note, separated by ` — `. Lines Genbeya can't read are flagged on the task, not ignored, and count as missing data.
- **Logging:** **Log time** on the task panel asks for the amount and an optional note; the date and name are filled in. It can also update `remaining` in the same step, which is when people know it best. No timers, no clocking in.
- **New lines go last**, so logs written on two branches merge like comments do.
- **Corrections** are ordinary edits of the lines.
- **Off by default:** the time log is a project decision (the project layer of [Optional parts](Optional-parts.md)), since entries are visible to everyone with the repository and stay in its history.
- **Sums by work, not by person:** Genbeya adds the log up per task, epic and milestone. It doesn't rank people or report hours per developer, and offers no attendance, overtime, billing or invoices.

## Plan history and baselines

Git keeps every version of every task, so the plan has a history without storing one. [Task activity](../Guide/Tasks.md#activity) already reads field changes out of a task's history; across all tasks, the same gives:

- **Remaining over time:** a burn chart per epic or milestone, with the logged effort from the time log next to it.
- **Changes since a baseline:** a baseline is a tag (or any commit) the team agreed on. Compared with it, Genbeya lists the tasks added, the estimates raised, the dates moved and the dependencies added, each with its commit and author. That explains why a forecast moved.

A commit is only a baseline when the team says so; plain history is not one.

Field changes are only as precise as the commits: on the [Content branch](../Architecture/Content-branch.md) every edit is committed right away, in the checkout only when someone commits.

## Later, if asked

- Workload against capacity per person or team, to check whether a plan is realistic, not to measure people.
- Calculated scheduling, with calendars and capacity.
- Scenarios: alternative plans compared without touching the agreed baseline.
- Costs and earned value.

## Open questions

- **Effort:** keep `effort` as a field type, or a number field with the unit set once for the project? The prototype has the type, with hours and days.
- **Milestones:** a field on tasks, as in the prototype, or something with its own date (a wiki page, or an entry in `.genbeya.yml`) so that "due after its milestone" can be checked?
- **Macros:** are the names and the filter syntax right? They render in the VS Code preview too.
- **Time log:** a section of its own, as in the prototype, or an effort on a comment (`### Alex — 2026-10-21 14:00+02:00 — 2h`)? The section reads better; the comment needs no second structure in the file.
