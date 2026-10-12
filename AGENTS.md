<!-- genbeya:begin -->

## Tasks and wiki (Genbeya)

This project plans its work as Genbeya tasks and documents itself in a Genbeya wiki, both plain Markdown files in this repository.

- Use tasks instead of an internal todo list. Tasks are files in `tasks/` named after their ID (`GENBEYA-12.md`). Create one for work you plan, keep its `status` current as you go, and tick its checklist.
- Use the wiki instead of private memory files. Pages are Markdown files in `docs/`, starting at `docs/Home.md`. Read the relevant pages before you change an area, and record durable project knowledge there.
- `.genbeya.yml` holds the workflow states, the task prefix and the folders. If `git worktree list` shows a worktree inside `.git/genbeya/`, its `.genbeya-content` file says which areas (`wiki`, `tasks`, `settings`) live there (`branch`) and which in the checkout (`checkout`); without that file all three live there. Edit and commit an area on the content branch in that worktree.
- Reference tasks, pages and files as `[[GENBEYA-12]]`, `[[Page title]]` or `[[src/file.ts#L10-L20]]`, and name the task in commit messages and pull requests.
- The `genbeya` skill (`.agents/skills/genbeya/SKILL.md`) describes the file formats and the workflow in detail.

<!-- genbeya:end -->
