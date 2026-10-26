---
id: GENBEYA-65
title: Critical path, float and arrow diagrams
type: feature
status: in-progress
priority: medium
labels: [planning, wiki]
---

The critical path method over the unfinished tasks: how long each still takes, its earliest and latest start and finish, its total and free float (slack), and which tasks are critical. Done when a task shows its float or that it is critical, `[FLOAT]` tables the schedule, and `[ARROWS]` draws it as an arrow diagram (activity on arrow): events with their earliest and latest day, tasks as arrows with their duration and float, dummy arrows where tasks share what they wait for, the critical path in red. See [[Design/Planning#the-prototype]].

Prototype on `feature/planning-prototype`. Durations come from a `duration` field (an effort), else the start and due dates, else the remaining effort or estimate at 8 hours a day; finished tasks are left out, tasks in a cycle too. Days count from today, without a calendar.

- [x] Durations, the forward and backward pass, total and free float, with spec tests (`src/utilities/planning.ts`)
- [x] `[FLOAT]`: the schedule as a table
- [x] `[ARROWS]`: the arrow diagram, with dummies and the critical path
- [x] The task panel: float, or on the critical path
- [x] Demo tasks to try it: the *Planning demo* epic and [[Planning demo]]
- [ ] Working days and holidays: a calendar, to show dates instead of days from today
- [ ] Mark critical tasks on the timeline (`[GANTT]`) and on the board
- [x] Document in [[Guide/Wiki]] and [[Guide/Tasks]]
