# Planning demo

> [!WARNING]
> **Demo only**, for trying the [Planning](Planning.md) prototype: everything below is worked out from the fake tasks of the milestone `DEMO`, in the *Planning demo* epic, which are not real work. Delete this page and that epic once planning is tested.

[TOC]

## Effort

Estimate, logged, remaining, forecast and variance per task. GENBEYA-64 has a remaining effort that isn't one, and a time log line that can't be read.

[EFFORT milestone=DEMO]

## What waits for what

[DEPENDENCIES milestone=DEMO]

## Timeline

Tasks with a due date; GENBEYA-63 has only a due date and is a milestone. GENBEYA-60 starts before GENBEYA-58, which it waits for, is due.

[GANTT milestone=DEMO]

## Critical path

The work that is left, as an arrow diagram: GENBEYA-58 → 59 → 62 → 63 is critical; GENBEYA-60 has a day of float, GENBEYA-61 five and a half.

[ARROWS milestone=DEMO]

[FLOAT milestone=DEMO]

## Filters

Only the tasks of one status, then one label, then a filter that matches nothing:

[EFFORT milestone=DEMO status=todo]

[DEPENDENCIES label=demo]

[EFFORT milestone=NOPE]
