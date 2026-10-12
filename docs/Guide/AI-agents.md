# AI agents

Coding agents such as Claude Code, Codex, GitHub Copilot, Cursor, Gemini CLI and OpenCode keep their own todo lists and memory files, which nobody else sees. Genbeya teaches them to use the repository's tasks and wiki instead: they plan work as tasks, move them across the board as they go, and write what they learn into the wiki, where the team reads it.

[TOC]

## Adding the files

**Settings → AI agents** lists the files with their state — *Not added*, *Up to date* or *Outdated* — and a preview of what each says. Tick the ones you want and press **Add to repository**, or **Update** once they are outdated. The files are written to the checkout, next to the code, and show up in **Changes**: review and commit them like code.

| File | Holds | Read by |
| --- | --- | --- |
| `.claude/skills/genbeya/SKILL.md` | The Genbeya skill: file formats and workflow | Claude Code; GitHub Copilot, Cursor and OpenCode read it too |
| `.agents/skills/genbeya/SKILL.md` | The same skill | Codex, Gemini CLI, GitHub Copilot, Cursor and OpenCode — not Claude Code |
| `AGENTS.md` | A short Genbeya section that points to the skill | Codex, GitHub Copilot, Cursor, OpenCode and most other agents; Claude Code only in a repository without CLAUDE.md |
| `CLAUDE.md` | `@AGENTS.md`, which Claude Code imports; the section itself when AGENTS.md is not added | Claude Code |
| `.github/copilot-instructions.md` | The section of AGENTS.md | GitHub Copilot. Off by default, since Copilot reads AGENTS.md as well |

The skill follows the open [Agent Skills](https://agentskills.io) format: a folder with a `SKILL.md` whose frontmatter names the skill and says when to use it. Agents keep only the name and description in mind and read the rest when the work calls for it, so the skill costs little context. Agents disagree on where skills live: Claude Code reads `.claude/skills/` but not `.agents/skills/`, Codex and Gemini CLI the other way round, so Genbeya writes both.

Claude Code reads AGENTS.md by itself only when the repository has no CLAUDE.md, and older versions never do. The one-line CLAUDE.md that imports it works either way, next to any instructions of your own.

> [!TIP]
> Gemini CLI reads `GEMINI.md` unless told otherwise. Add `"context": { "fileName": ["AGENTS.md", "GEMINI.md"] }` to `.gemini/settings.json` and it reads AGENTS.md too.

Genbeya's own repository has these files as well: [AGENTS.md](../../AGENTS.md) and [.agents/skills/genbeya/SKILL.md](../../.agents/skills/genbeya/SKILL.md).

## What agents learn

- Use tasks instead of an internal todo list, and the wiki instead of private memory files such as CLAUDE.md memories or `.cursor` notes.
- Find the settings, wiki and tasks: read `.genbeya.yml`, and check `git worktree list` for a [Content branch](../Architecture/Content-branch.md).
- Create a task: the next free ID across all epics, a file named after it, the frontmatter fields, epics as folders, checklists for subtasks.
- Move a task through the workflow as the work progresses, and to the last state only when it is done and verified.
- Reference tasks, pages and files with `[[…]]`, and name the task in commit messages and pull requests.
- Write wiki pages: where they go, how file names become titles, subpages, diagrams and callouts.
- Change only the fields they mean to change, keeping other frontmatter fields, comments and line endings.

The workflow states are not written into the files: agents read them from `.genbeya.yml` when they work, so changing the workflow needs no update. The folders and the task prefix are filled in; after changing those, the files show *Outdated* — press **Update** and commit the result.

## Your own text stays

In AGENTS.md, CLAUDE.md and Copilot's file, Genbeya owns only the lines from `<!-- genbeya:begin -->` to `<!-- genbeya:end -->`. It appends that block to a file that has none and replaces it on update; everything outside the block stays as it was, line endings included. Adding again when nothing changed writes nothing. Put your own instructions outside the block.

The skill files belong to Genbeya entirely, and **Update** replaces them. Keep project-specific guidance in AGENTS.md or in the wiki instead.

> [!NOTE]
> Many repositories ignore `.claude/` in `.gitignore`. The section warns about files that would not be committed; ignore only `.claude/settings.local.json` and similar personal files instead, so everyone's agents get the skill.

## With a content branch

When the wiki, the tasks or the settings live on a [Content branch](../Architecture/Content-branch.md), the agent files still go into the checkout, because they belong with the code. They tell agents to look for the worktree inside `.git/genbeya/`, read its `.genbeya-content` file to learn which areas live there, and edit and commit those there; the other areas stay in the checkout.
