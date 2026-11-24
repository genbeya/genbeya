---
id: GENBEYA-69
title: Draw plans on the website, with the app's own plan rendering
type: feature
status: todo
priority: medium
labels: [website, planning, docs]
milestone: 0.2.1
---

genbeya.fyi shows the wiki, but plan blocks such as `[EFFORT]` or `[DEPENDENCIES]` appear there only as a note naming the block (genbeya/website#4). The Planning demo page has eight of them. The site's build already reads the release's tasks and settings, so it can draw them, with the app's code and no copy of the plan logic.

### In the app

- [ ] Export one function next to `plan()` in `src/client/app/markdown/remark-genbeya.ts`: from the task files, `.genbeya.yml` and a date, the Markdown nodes a plan block becomes, as in the app (tables for `[EFFORT]` and `[FLOAT]`, Mermaid for `[DEPENDENCIES]` and `[ARROWS]`, PlantUML for `[GANTT]`). It parses tasks and settings with the pure engines; `plan()` itself stays where it is
- [ ] A unit test pins its signature and output, since the website builds against it

### In genbeya/website

- [ ] `sync-docs` bundles that function from the release checkout, computes each plan block of the docs once, and stores the nodes in the generated docs index; no app code runs in the Astro build
- [ ] The site's remark plugin replaces each block with its stored nodes; tables render as tables and Mermaid as diagrams, through the site's own pipeline
- [ ] Without the function (releases up to 0.2.0) or when it fails, the page keeps the note
- [ ] Plans are as of the build date; the `[FLOAT]` table already names it

### Not in this task

- `[GANTT]` is PlantUML, which the site shows as source, as all PlantUML there. Drawing PlantUML with rockuml at build time is a separate improvement to the website.
- `[BURNDOWN]` and `[BASELINE]` read the tasks' Git history, which the site's build doesn't check out; they keep the note.
- The kit ([[GENBEYA-68]]) needs nothing from this: it renders through the client's pipeline, and with it `plan()`, as the VS Code webviews do.
