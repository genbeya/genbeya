---
id: GENBEYA-69
title: Draw plans on the website, with the app's own plan rendering
type: feature
status: done
priority: medium
labels: [website, planning, docs]
milestone: 0.2.1
---

genbeya.fyi shows the wiki, but plan blocks such as `[EFFORT]` or `[DEPENDENCIES]` appear there only as a note naming the block (genbeya/website#4). The Planning demo page has eight of them. The site's build already reads the release's tasks and settings, so it can draw them, with the app's code and no copy of the plan logic.

### In the app

- [x] Export one function next to `plan()` in `src/client/app/markdown/remark-genbeya.ts`: from the task files, `.genbeya.yml` and a date, the Markdown nodes a plan block becomes, as in the app (tables for `[EFFORT]` and `[FLOAT]`, Mermaid for `[DEPENDENCIES]` and `[ARROWS]`, PlantUML for `[GANTT]`). It parses tasks and settings with the pure engines; `plan()` itself stays where it is
- [x] A unit test pins its signature and output, since the website builds against it

### In genbeya/website

- [x] `sync-docs` bundles that function from the release checkout, computes each plan block of the docs once, and stores the nodes in the generated docs index; no app code runs in the Astro build
- [x] The site's remark plugin replaces each block with its stored nodes; tables render as tables and Mermaid as diagrams, through the site's own pipeline
- [x] Without the function (releases up to 0.2.0) or when it fails, the page keeps the note
- [x] Plans are as of the build date; the `[FLOAT]` table already names it

### Not in this task

- `[GANTT]` is PlantUML, which the site shows as source, as all PlantUML there. Drawing PlantUML with rockuml at build time is a separate improvement to the website.
- `[BURNDOWN]` and `[BASELINE]` read the tasks' Git history, which the site's build doesn't check out; they keep the note.
- The kit ([[GENBEYA-68]]) needs nothing from this: it renders through the client's pipeline, and with it `plan()`, as the VS Code webviews do.

### Claude — 2026-11-24 08:07+01:00

The function lives in `src/shells/docs/plans.ts`, not next to `plan()`: parsing task files and `.genbeya.yml` needs the engines, which the client may not import. The docs shell may, so it parses with them and calls `plan()` (now exported, with `PLAN`, from the client's remark plugin). `docsPlans(settingsText, taskFiles, today)` returns how many tasks it read and `draw(block)`, the Markdown nodes a block becomes, or null for `[BURNDOWN]`, `[BASELINE]`, other text and projects without planning. `plans.spec.ts` pins it. The website half follows in genbeya/website, and can only use this once a release has it.

### Claude — 2026-11-24 08:13+01:00

The website half is genbeya/website#6. `sync-docs` bundles this module from the checkout with Vite, draws each plan block once and keeps the nodes in the docs index; the site's remark plugin puts them in place of the blocks. Synced from this branch, the Planning demo page draws all 8 of its blocks (3 tables, 3 diagrams); from a bare export, as CI checks the release out, the same; from `v0.2.0` every block keeps its note. Plans appear on genbeya.fyi once 0.2.1 is released and the website deployed.

### Claude — 2026-11-26 07:52+01:00

Live since 0.2.1: the website's deploy draws all 8 blocks of the Planning demo page from the release (genbeya/website#7). The drawn tables overflowed the text column by up to 80 pixels; genbeya/website#8 fits them by leaving the status out of their task chips and tightening their cells.
