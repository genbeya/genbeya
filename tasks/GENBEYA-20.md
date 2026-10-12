---
id: GENBEYA-20
title: Try Genbeya in the browser
type: feature
status: in-progress
priority: high
labels: [web, demo]
---

A "try me" build that runs entirely in a web page, for https://genbeya.fyi/try/: the sample project opens right away, and visitors try the wiki, the board, the editor, Changes and History without installing anything. Nothing is stored or sent; a reload starts over. See [[Demo]].

- [ ] Choose how the backend is simulated (Git emulator behind the machine port, or managers on an in-memory repository) and write it down
- [ ] In-memory repository: commits, index, working tree, branches, tags, stashes, merges with conflicts, rebases, resets, cherry-picks, reverts, a simulated remote
- [ ] Demo managers on it, reusing the engines
- [ ] Demo platform connector; layout choices kept in memory instead of local storage
- [ ] Demo badge with Reset demo and Download Genbeya; the terminal says it isn't available
- [ ] `npm run build:demo`: a static bundle that works under any sub-path and loads nothing from elsewhere
- [ ] End-to-end test of the demo in Chromium
- [ ] CI attaches `genbeya-web-demo.zip` to each release
- [ ] Documentation: Architecture/Demo, Development
