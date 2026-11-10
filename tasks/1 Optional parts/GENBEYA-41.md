---
id: GENBEYA-41
title: Load only the parts of the app that are shown
type: improvement
status: backlog
priority: low
labels: [settings, performance]
---

Hiding parts ([[GENBEYA-39]], [[GENBEYA-40]]) is a matter of the client; the backend still builds a snapshot of every page, task and setting when a repository opens. Done when an area that is not shown is not read, so turning parts off saves memory and time, most of all for large repositories over SSH. See [[Design/Optional-parts#loading-only-what-is-shown]].

- [ ] Measure what the snapshot costs per area on a large repository
- [ ] Split the snapshot by area, loaded when the area is first shown
- [ ] References and search still reach a hidden area when asked
- [ ] Demo counterpart, `npm run e2e:demo`
- [ ] Update [[Architecture/Managers]]
