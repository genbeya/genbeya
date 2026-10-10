# AI agents

Coding agents such as Claude Code, Codex, GitHub Copilot, Cursor and Gemini CLI keep their own todo lists and memory files, which nobody else sees. GitDesk teaches them to use the repository's tasks and wiki instead: they plan work as tasks, move them across the board as they go, and write what they learn into the wiki, where the team reads it.

[TOC]

## Adding the files

**Settings → AI agents** lists the files with their state — *Not added*, *Up to date* or *Outdated* — and a preview of what each says. Tick the ones you want and press **Add to repository**, or **Update** once they are outdated. The files are written to the checkout, next to the code, and show up in **Changes**: review and commit them like code.

| File | Holds | Read by |
| --- | --- | --- |
| `.claude/skills/gitdesk/SKILL.md` | The GitDesk skill: file formats and workflow | Claude Code; GitHub Copilot and Cursor look here too |
| `.agents/skills/gitdesk/SKILL.md` | The same skill | Codex, Gemini CLI, Cursor, OpenCode, Copilot in VS Code |
| `AGENTS.md` | A short GitDesk section that points to the skill | Codex, Copilot, Cursor and most other agents |
| `CLAUDE.md` | `@AGENTS.md`, which Claude Code imports; the section itself when AGENTS.md is not added | Claude Code |
| `.github/copilot-instructions.md` | The section of AGENTS.md | GitHub Copilot. Off by default, since Copilot reads AGENTS.md as well |

The skill follows the open [Agent Skills](https://agentskills.io) format: a folder with a `SKILL.md` whose frontmatter names the skill and says when to use it. Agents keep only the name and description in mind and read the rest when the work calls for it, so the skill costs little context. Agents disagree on where skills live; the two folders above cover the common ones.

> [!TIP]
> Gemini CLI reads `GEMINI.md` unless told otherwise. Add `"context": { "fileName": ["AGENTS.md", "GEMINI.md"] }` to `.gemini/settings.json` and it reads AGENTS.md too.

GitDesk's own repository has these files as well: [[AGENTS.md]] and [[.agents/skills/gitdesk/SKILL.md]].

## What agents learn

- Use tasks instead of an internal todo list, and the wiki instead of private memory files such as CLAUDE.md memories or `.cursor` notes.
- Find the settings, wiki and tasks: read `.gitdesk.yml`, and check `git worktree list` for a [[Content branch]].
- Create a task: the next free ID across all epics, a file named after it, the frontmatter fields, epics as folders, checklists for subtasks.
- Move a task through the workflow as the work progresses, and to the last state only when it is done and verified.
- Reference tasks, pages and files with `[[…]]`, and name the task in commit messages and pull requests.
- Write wiki pages: where they go, how file names become titles, subpages, diagrams and callouts.
- Change only the fields they mean to change, keeping other frontmatter fields, comments and line endings.

The workflow states are not written into the files: agents read them from `.gitdesk.yml` when they work, so changing the workflow needs no update. The folders and the task prefix are filled in; after changing those, the files show *Outdated* — press **Update** and commit the result.

## Your own text stays

In AGENTS.md, CLAUDE.md and Copilot's file, GitDesk owns only the lines from `<!-- gitdesk:begin -->` to `<!-- gitdesk:end -->`. It appends that block to a file that has none and replaces it on update; everything outside the block stays as it was, line endings included. Adding again when nothing changed writes nothing. Put your own instructions outside the block.

The skill files belong to GitDesk entirely, and **Update** replaces them. Keep project-specific guidance in AGENTS.md or in the wiki instead.

> [!NOTE]
> Many repositories ignore `.claude/` in `.gitignore`. The section warns about files that would not be committed; ignore only `.claude/settings.local.json` and similar personal files instead, so everyone's agents get the skill.

## With a content branch

When the wiki and tasks live on a [[Content branch]], the agent files still go into the checkout, because they belong with the code. They tell agents to look for the worktree inside `.git/gitdesk/` and to edit and commit tasks and pages there.
