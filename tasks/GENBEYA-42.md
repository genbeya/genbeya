---
id: GENBEYA-42
title: References pinned to a revision
type: feature
status: backlog
priority: medium
labels: [references]
---

`[[path#L42-L48@<revision>]]` refers to lines of a file as they were in a commit, and `![[…@<revision>]]` embeds them. [[Design/Pull-requests]] need it, and pages can embed code as it was in a release. Done when pinned references render, open the file read-only at that revision with the lines selected, embed those lines, and say when the lines differ from the checkout. See [[Design/Pinned-references]].

- [ ] Decide the grammar: paths with `@`, whole files, full commit IDs or any revision
- [ ] Link engine: parse the revision, with spec tests
- [ ] Reference renderer: short revision, outdated marker, dashed when the commit is missing
- [ ] Open a file at a revision in **Code**, read-only, lines selected
- [ ] Embeds of a revision
- [ ] VS Code extension: references and embeds in its preview and editor
- [ ] Demo counterpart, `npm run e2e:demo`
- [ ] Document in [[Guide/References]]
