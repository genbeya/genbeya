---
id: GENBEYA-22
title: References and preview in VS Code's Markdown editor
type: feature
status: review
priority: high
labels: [vscode]
---

Pages and tasks are edited in VS Code's own Markdown editor, which knows nothing of Genbeya's references. Teach it, reusing the link engine. (Genbeya's preview renders them already.)

- [x] `[[…]]` completion of tasks, pages and files
- [x] Hover with a task's title and status, a page's title
- [x] Document links: Ctrl+click opens the task, page or file (lines too)
- [x] Missing pages and tasks as diagnostics
- [x] `@mention` completion of the repository's people, and `//` dates
- [x] Open the Genbeya preview beside the editor, scrolled along with it (by share of the length; line-exact scrolling would need source positions in the rendered page)
