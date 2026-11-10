---
id: GENBEYA-39
title: Let a project declare which parts of the app it doesn't use
type: feature
status: backlog
priority: medium
labels: [settings]
---

The project layer of [[Design/Optional-parts]]: `.genbeya.yml` says which parts the project doesn't use (wiki, tasks, planning, time log, code, changes, history, terminal, pull requests), and nobody sees them. Done when a part the project doesn't use is gone from the sidebar, the palette, search, onboarding and the generated agent instructions, and its files are untouched.

- [ ] Decide the key and its shape (`unused: [...]` or a list of used parts) and the part names
- [ ] Settings engine: read and validate it, including parts that need another (planning needs tasks, the time log needs planning)
- [ ] **Settings → Project**: a switch per part, saying what else goes with it
- [ ] Agent engine: leave unused parts out of the `AGENTS.md` section and the skill
- [ ] Search and onboarding leave unused parts out
- [ ] VS Code extension follows the project layer
- [ ] Demo counterpart, `npm run e2e:demo`
- [ ] Document in [[Guide/Settings]]
