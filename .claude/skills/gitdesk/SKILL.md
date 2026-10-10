---
name: gitdesk
description: Plan, track and document work in this repository with GitDesk tasks and wiki pages. Use when planning or breaking down work, when starting, updating or finishing a task, when looking up or recording project knowledge, and when referencing tasks such as GENBEYA-12 in commits, pull requests or documentation. Tasks live in tasks/, the wiki in docs/.
---

# GitDesk tasks and wiki

This repository keeps its task board and its wiki as plain files, managed with GitDesk. People follow your work on the board and read what you document in the wiki, so:

- **Use tasks instead of your internal todo list.** Plan work as tasks, keep their status current while you work, and tick their checklists as steps get done.
- **Use the wiki instead of private memory files.** Record durable project knowledge (architecture, decisions and their reasons, conventions, how-tos, pitfalls) as wiki pages, not in agent-private notes such as CLAUDE.md memories or `.cursor` notes. Read the relevant pages before you change an unfamiliar area.

Edit the files directly; GitDesk picks up changes on its own.

## Find the files

1. Run `git worktree list`. A worktree inside `.git/gitdesk/` holds GitDesk's _content branch_ (`gitdesk`, or the branch `git config gitdesk.branch` names). Whatever of `.gitdesk.yml`, the wiki folder and the task folder exists there lives there, not in the checkout: read and edit it in that worktree, and commit your edits there (`git -C <worktree> add …` and `git -C <worktree> commit -m …`). Never copy those files into the checkout. GitDesk pushes the content branch when someone syncs it.
2. Read `.gitdesk.yml`. When it disagrees with the values below, the file wins:
   - `wikiRoot` is the wiki folder (here `docs`), `wikiHome` its home page relative to that folder (here `Home.md`).
   - `taskRoot` is the task folder (here `tasks`), `taskPrefix` the prefix of task IDs (here `GD`).
   - `statuses` are the workflow states in board order: the first is where new ideas wait, the last means done. An entry is a state's name, or a mapping whose `name` is the state.
   - `hiddenColumns` are states the board leaves out; tasks may still be in them.
   - If present, `types` lists task types and `fields` custom task fields. Use only the names and values defined there.

## Tasks

Each task is one Markdown file named after its ID, in the task folder or in an epic folder below it: `tasks/GENBEYA-12.md`, `tasks/Login rework/GENBEYA-14.md`.

```markdown
---
id: GENBEYA-12
title: Virtualize long lists
status: todo
priority: medium
assignee: alice
labels: [performance]
---

Render only the visible rows of long lists.

- [ ] File tree
- [ ] History
```

- `id`, `title` and `status` are required; `status` is one of the configured states.
- `priority` is `urgent`, `high`, `medium` or `low`; leave it out for none. `assignee` and `labels` are optional.
- The description below the frontmatter is Markdown. Its checklist items (`- [ ]`, `- [x]`) are the task's subtasks; the board shows their progress.
- An epic is a folder below the task folder, and epics may nest (`Auth/Tokens`). A task without an epic sits in the task folder itself.
- If present, a `## Comments` section below the description holds the discussion. Add your comments at its end in the format of the existing ones, and never edit other people's comments.

### Create a task

1. Take the next free ID: the highest number used with the prefix by any task below the task folder, epics included, plus one (`GENBEYA-12` → `GENBEYA-13`). Make sure no file of that name exists anywhere below the task folder.
2. Write `<task folder>/[<epic>/]<ID>.md` with `id`, `title` and `status`, the optional fields that apply, and a description that says what done means.
3. Break the work down into a checklist. Give a step its own task only when it deserves tracking of its own, and reference it from the description (`[[GENBEYA-13]]`).

### Work on a task

Keep the board true while you work. Use the configured states by their meaning, such as `todo` → `in-progress` → `review` → `done`, and skip meanings the workflow does not have:

- Move the task to the in-progress state when you start, to the review state when your work waits for review, and to the last state only once the work is complete and verified.
- Tick checklist items as they get done, and add the ones you discover.
- Note decisions and blockers in the description, or as comments when the file has a `## Comments` section.
- Change only the fields you mean to change. Keep other frontmatter fields, their order, YAML comments and the file's line endings; do not reformat the frontmatter. Never change a task's `id` or file name.
- Move a task to another epic by moving its file (`git mv`) into that epic's folder.
- Do not delete tasks: move abandoned ones to the last state and say why.

## References

In wiki pages and task descriptions, `[[…]]` links anything in the repository, and GitDesk shows what it points to:

- `[[GENBEYA-12]]` is a task, shown with its title and state.
- `[[Getting started]]` or `[[Guide/Wiki]]` is a wiki page, by title or by its path below the wiki folder without `.md`.
- `[[src/app.ts]]` or `[[src/app.ts#L10-L20]]` is a file, or lines of it.
- `[[GENBEYA-12|the login bug]]` is any reference with your own text.
- `![[src/app.ts#L10-L20]]` on a line of its own embeds those lines, always in their current version.

Task IDs written plainly (`GENBEYA-12`) link to the task as well. Name the task you worked on in commit messages and pull request descriptions (`GENBEYA-12: Virtualize the file tree`), so the history leads back to it.

## Wiki

- Every page is a Markdown file below the wiki folder; the home page is `docs/Home.md`.
- The file name is the title, with dashes for spaces: `docs/Getting-started.md` is "Getting started". Start the page with its title as a `#` heading.
- A page and a folder of the same name belong together: `docs/Guide.md` is the page, `docs/Guide/` holds its subpages. Put a new page below the page it belongs to.
- Search the wiki before writing. Extend the page that covers a topic instead of starting another one, and correct what is out of date.
- When you move or rename a page, move its subpage folder along and update the references to it.
- Link pages with `[[…]]` references or relative Markdown links (`[Tasks](Guide/Tasks.md)`).
- Draw architecture, flows and sequences as diagrams: fenced code blocks in the language `mermaid` or `plantuml` render as diagrams.
- `[TOC]` inserts a table of contents and `[SUBPAGES]` lists the pages below; `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` start callouts.
- Write for the team: current facts, decisions with their reasons, how-tos. Keep session logs and scratch notes out of the wiki.

## Ground rules

- Edit `.gitdesk.yml` only when asked to.
- Keep task files and pages in their format: people and other tools read them too.
- In the checkout, commit task and wiki edits like code, together with the work they describe.
