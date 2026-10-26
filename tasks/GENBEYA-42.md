---
id: GENBEYA-42
title: References pinned to a revision
type: feature
status: review
priority: medium
labels: [references]
---

`[[path#L42-L48@<revision>]]` refers to lines of a file as they were in a commit, and `![[…@<revision>]]` embeds them. [[Design/Pull-requests]] need it, and pages can embed code as it was in a release. Done when pinned references render, open the file read-only at that revision with the lines selected, embed those lines, and say when the lines differ from the checkout. See [[Guide/References#pinned-to-a-revision]].

Decided:

- **Grammar:** the revision follows the lines, after `@`: `#L42-L48@v1.0`, and `#@v1.0` for a whole file. Paths may hold `@` (`node_modules/@types/…`), fragments can't, so it is never ambiguous.
- **Revisions:** anything Git resolves (commit ID, tag, branch, `HEAD~2`), never something Git could read as an option, a path, a range or reflog syntax (`isRevision`).
- **Pages:** a page pinned to a revision (`[[Home#L3@v1.0]]`) is its Markdown file at that revision.
- **Outdated:** the same line numbers compared with the checkout; lines that only moved count as changed.
- **Moves:** moving pages or files never rewrites pinned references.

- [x] Decide the grammar: paths with `@`, whole files, full commit IDs or any revision
- [x] Link engine: parse the revision, with spec tests
- [x] Reference renderer: short revision, outdated marker, dashed when the commit is missing
- [x] Open a file at a revision in **Code**, read-only, lines selected
- [x] Embeds of a revision
- [x] VS Code extension: references and embeds in its preview and editor
- [x] Demo counterpart (`versionControl.fileAt` on the in-memory repository)
- [x] `npm run e2e:demo`, the client unit tests and the end-to-end tests, in CI ([run 42](https://github.com/genbeya/genbeya/actions/runs/40294055497))
- [x] Document in [[Guide/References]]
