# Design

Proposals for features that are not built yet: what they would add, how they fit the plain-file foundation, and what is still open. A proposal becomes part of the [Guide](Guide.md) and [Architecture](Architecture.md) once it is built; until then, its tasks in the backlog track it.

> [!NOTE]
> These pages are drafts for discussion. "Decided" marks what has been agreed; everything else is a proposal.

[TOC]

## Proposals

| Page | Adds | Tasks |
| --- | --- | --- |
| [Optional parts](Design/Optional-parts.md) | Turning areas of the app on and off, for a project and for each user | [[GENBEYA-39]], [[GENBEYA-40]], [[GENBEYA-41]] |
| [Pinned references](Design/Pinned-references.md) | `[[…]]` references to lines of a file at a revision | [[GENBEYA-42]] |
| [Planning](Design/Planning.md) | Estimates, remaining and logged effort, dependencies, and plans as live wiki macros | [[GENBEYA-43]] to [[GENBEYA-49]] |
| [Pull requests](Design/Pull-requests.md) | Code review in one Markdown file per pull request, with suggestions, verdicts and a cleanup into tasks and pages | [[GENBEYA-50]] to [[GENBEYA-56]] |

Suggested order: optional parts first, so every new feature is born switchable; then pinned references, which pull requests need and which are useful on their own; then planning; then pull requests.

## Keeping Genbeya lean

Every proposal is measured against the same test. Genbeya keeps three kinds of content (pages, tasks, settings) and five views; what makes a feature expensive is:

- **A new kind of content.** It needs its own folder, a place in [[Content branch|where content lives]], search, the agent skill and the VS Code tree.
- **A new view.**
- **A new manager call.** Each one exists three times: the backend, the [[Demo]] and the [[Architecture/VS-Code|VS Code extension]].

Pure engine rules and rendering in the existing Markdown pipeline cost little by comparison. So each proposal reuses what exists before it adds anything:

- Fields before schemas: [custom fields](Guide/Tasks.md#custom-fields) already hold numbers, dates and choices.
- Derived before stored: Git history, the current branches and the task files are the data; charts, sums and states are computed from them, never written back.
- Macros before views: a plan is a wiki page with live blocks such as `[TOC]` and `[SUBPAGES]` today, rather than a new screen.
- One line format: structured lines in Markdown (time log entries, pull request replies and verdicts) share the name and date format of [task comments](Guide/Tasks.md#comments), so one parser reads them and lines it cannot read are flagged, never dropped.
- Switchable: every new area can be turned off, which keeps it behind a clean boundary ([Optional parts](Design/Optional-parts.md)).

And a test for every file format: someone without Genbeya can open the file in a plain editor, understand it, change it, and find what it points at with Git.
