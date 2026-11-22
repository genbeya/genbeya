---
id: GENBEYA-43
title: Planning fields for estimate, remaining effort, dates and milestones
type: feature
status: review
priority: medium
labels: [planning]
---

Custom fields named `estimate`, `remaining`, `start`, `due` and `milestone` take on their planning meaning, and effort is an amount in the project's unit (`16h`, `2d`). Done when a project can configure them, they show on cards and in the task panel, and the board can filter by milestone. See [[Design/Planning#task-fields]].

Built on `feature/planning-prototype`: `effort` is a field type (hours or days, a day being 8 hours); a milestone is a field value.

- [x] Decide: an `effort` field kind, or a number with the unit set once for the project
- [x] Decide: what a milestone is (a field value, or something with its own date)
- [x] Settings engine: the effort kind and the project's unit, with validation
- [x] Task engine: read and write effort values, keep unknown ones as they are
- [x] Task panel and cards: estimate and remaining, with forecast and variance once [[GENBEYA-48]] logs effort
- [x] **Filter by** milestone
- [x] Only while Planning is on ([[GENBEYA-39]])
- [x] Demo counterpart, `npm run e2e:demo`
- [x] Document in [[Guide/Tasks]] and [[Guide/Settings]]
