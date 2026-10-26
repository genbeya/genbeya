---
id: GENBEYA-45
title: Dependency graph as a wiki macro
type: feature
status: backlog
priority: medium
labels: [planning, wiki]
---

`[DEPENDENCIES …]` on a wiki page draws the dependency graph ([[GENBEYA-44]]) of the matching tasks with the Mermaid renderer, live from the task files. Done when the macro renders in the wiki and the VS Code preview, filters by epic, milestone, assignee, label and type, and a click on a task opens it. See [[Design/Planning#plans-as-wiki-macros]].

- [ ] Decide the macro names and the filter syntax, shared by [[GENBEYA-46]] and [[GENBEYA-47]]
- [ ] Engine: tasks and filters to a Mermaid flowchart, with spec tests
- [ ] Renderer: the macro in pages, task descriptions and previews; clickable tasks
- [ ] Blocked, ready and done tasks styled by state; cycles marked
- [ ] VS Code preview
- [ ] Document in [[Guide/Wiki]]
