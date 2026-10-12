/**
 * The text that teaches coding agents to work with Genbeya: an Agent Skill
 * (SKILL.md) with the file formats and the workflow, and a short section for
 * instruction files such as AGENTS.md. Only folders, the task prefix and the
 * settings file's name come from the repository; agents read everything else
 * from the settings file when they work, so the text stays right when
 * workflow states change.
 */
import type { Settings } from "../contracts/model";

export const SKILL_NAME = "genbeya";

/** The name of the repository's settings file: `.genbeya.yml`, or `.gitdesk.yml` where GitDesk set it up. */
export interface SettingsFile {
  readonly settingsFile: string;
}

type Values = Pick<Settings, "wikiRoot" | "wikiHome" | "taskRoot" | "taskPrefix"> & SettingsFile;

/** A YAML scalar for the frontmatter; quoted only when the text would not parse as a plain one. */
const yamlScalar = (text: string): string => (/: | #|^[^A-Za-z]/.test(text) ? JSON.stringify(text) : text);

export function skill({ wikiRoot, wikiHome, taskRoot, taskPrefix: prefix, settingsFile }: Values): string {
  const description =
    `Plan, track and document work in this repository with Genbeya tasks and wiki pages. ` +
    `Use when planning or breaking down work, when starting, updating or finishing a task, when looking up or recording project knowledge, ` +
    `and when referencing tasks such as ${prefix}-12 in commits, pull requests or documentation. ` +
    `Tasks live in ${taskRoot}/, the wiki in ${wikiRoot}/.`;
  return `---
name: ${SKILL_NAME}
description: ${yamlScalar(description)}
---

# Genbeya tasks and wiki

This repository keeps its task board and its wiki as plain files, managed with Genbeya. People follow your work on the board and read what you document in the wiki, so:

- **Use tasks instead of your internal todo list.** Plan work as tasks, keep their status current while you work, and tick their checklists as steps get done.
- **Use the wiki instead of private memory files.** Record durable project knowledge (architecture, decisions and their reasons, conventions, how-tos, pitfalls) as wiki pages, not in agent-private notes such as CLAUDE.md memories or \`.cursor\` notes. Read the relevant pages before you change an unfamiliar area.

Edit the files directly; Genbeya picks up changes on its own.

## Find the files

1. Run \`git worktree list\`. A worktree inside \`.git/genbeya/\` holds Genbeya's _content branch_ (\`genbeya\`, or the branch \`git config genbeya.branch\` names). Its \`.genbeya-content\` file says where each area lives: \`wiki\`, \`tasks\` and \`settings\` (\`${settingsFile}\`) set to \`branch\` live in that worktree, those set to \`checkout\` in the checkout; a content branch without that file holds all three. Without such a worktree, everything lives in the checkout.
   - Genbeya was called GitDesk before. In repositories set up with GitDesk, the worktree may be inside \`.git/gitdesk/\`, the branch named \`gitdesk\` and the file \`.gitdesk-content\`; they mean the same.
   - Read and edit each area where it lives. Commit edits on the content branch right away, in that worktree (\`git -C <worktree> add …\` and \`git -C <worktree> commit -m …\`); Genbeya pushes them when someone syncs. Never copy files between the content branch and the checkout: the copy in the other place is out of date.
2. Read \`${settingsFile}\` where the settings live. When it disagrees with the values below, the file wins:
   - \`wikiRoot\` is the wiki folder (here \`${wikiRoot}\`), \`wikiHome\` its home page relative to that folder (here \`${wikiHome}\`).
   - \`taskRoot\` is the task folder (here \`${taskRoot}\`), \`taskPrefix\` the prefix of task IDs (here \`${prefix}\`).
   - \`statuses\` are the workflow states in board order: the first is where new ideas wait, the last means done. An entry is a state's name, or a mapping whose \`name\` is the state.
   - \`hiddenColumns\` are states the board leaves out; tasks may still be in them.
   - \`types\` lists the task types: names, or mappings whose \`name\` is the type (with an \`icon\` and a colour \`tone\` for Genbeya). Without \`types\`, the types are \`bug\`, \`feature\`, \`improvement\` and \`chore\`; \`types: []\` means none.
   - If present, \`fields\` lists custom task fields: each has a \`name\`, which is the frontmatter key, and a \`type\`: \`text\` (the default), \`number\`, \`date\` (written \`2026-05-01\`) or \`choice\`, whose value is one of its \`options\`.

## Tasks

Each task is one Markdown file named after its ID, in the task folder or in an epic folder below it: \`${taskRoot}/${prefix}-12.md\`, \`${taskRoot}/Login rework/${prefix}-14.md\`.

\`\`\`markdown
---
id: ${prefix}-12
title: Virtualize long lists
type: improvement
status: todo
priority: medium
assignee: alice
labels: [performance]
---

Render only the visible rows of long lists.

- [ ] File tree
- [ ] History
\`\`\`

- \`id\`, \`title\` and \`status\` are required; \`status\` is one of the configured states.
- \`priority\` is \`urgent\`, \`high\`, \`medium\` or \`low\`; leave it out for none. \`assignee\` and \`labels\` are optional.
- \`type\` is optional and one of the configured types. Custom fields are frontmatter keys named as in \`fields\`, with values of their kind; leave a field out when it has no value.
- The description below the frontmatter is Markdown. Its checklist items (\`- [ ]\`, \`- [x]\`) are the task's subtasks, which people tick in Genbeya too.
- An epic is a folder below the task folder, and epics may nest (\`Auth/Tokens\`). A task without an epic sits in the task folder itself. Folders whose names start with a dot hold no tasks.
- If present, a \`## Comments\` section below the description holds the discussion. Add your comments at its end in the format of the existing ones, and never edit other people's comments.

### Create a task

1. Take the next free ID: the highest number used with the prefix by any task below the task folder, epics included, plus one (\`${prefix}-12\` → \`${prefix}-13\`). Make sure no file of that name exists anywhere below the task folder.
2. Write \`<task folder>/[<epic>/]<ID>.md\` with \`id\`, \`title\` and \`status\`, the optional fields that apply, and a description that says what done means.
3. For a task of a type, start from the type's template if \`<task folder>/.templates/<type>.md\` exists: its description is the outline to fill in, and its frontmatter presets fields such as \`priority\` or \`labels\` (never \`id\`, \`title\` or \`status\`).
4. Break the work down into a checklist. Give a step its own task only when it deserves tracking of its own, and reference it from the description (\`[[${prefix}-13]]\`).

### Work on a task

Keep the board true while you work. Use the configured states by their meaning, such as \`todo\` → \`in-progress\` → \`review\` → \`done\`, and skip meanings the workflow does not have:

- Move the task to the in-progress state when you start, to the review state when your work waits for review, and to the last state only once the work is complete and verified.
- Tick checklist items as they get done, and add the ones you discover.
- Note decisions and blockers in the description, or as comments when the file has a \`## Comments\` section.
- Change only the fields you mean to change. Keep other frontmatter fields, their order, YAML comments and the file's line endings; do not reformat the frontmatter. Never change a task's \`id\` or file name.
- Move a task to another epic by moving its file (\`git mv\`) into that epic's folder.
- Do not delete tasks: move abandoned ones to the last state and say why.

## References

In wiki pages and task descriptions, \`[[…]]\` links anything in the repository, and Genbeya shows what it points to:

- \`[[${prefix}-12]]\` is a task, shown with its title and state.
- \`[[Getting started]]\` or \`[[Guide/Wiki]]\` is a wiki page, by title or by its path below the wiki folder without \`.md\`.
- \`[[src/app.ts]]\` or \`[[src/app.ts#L10-L20]]\` is a file, or lines of it.
- \`[[${prefix}-12|the login bug]]\` is any reference with your own text.
- \`![[src/app.ts#L10-L20]]\` on a line of its own embeds those lines, always in their current version.

Task IDs written plainly (\`${prefix}-12\`) link to the task as well. Name the task you worked on in commit messages and pull request descriptions (\`${prefix}-12: Virtualize the file tree\`), so the history leads back to it.

## Wiki

- Every page is a Markdown file below the wiki folder; the home page is \`${wikiRoot}/${wikiHome}\`.
- The file name is the title, with dashes for spaces: \`${wikiRoot}/Getting-started.md\` is "Getting started". Start the page with its title as a \`#\` heading.
- A page and a folder of the same name belong together: \`${wikiRoot}/Guide.md\` is the page, \`${wikiRoot}/Guide/\` holds its subpages. Put a new page below the page it belongs to.
- Search the wiki before writing. Extend the page that covers a topic instead of starting another one, and correct what is out of date.
- When you move or rename a page, move its subpage folder along and update the references to it.
- Link pages with \`[[…]]\` references or relative Markdown links (\`[Tasks](Guide/Tasks.md)\`).
- Draw architecture, flows and sequences as diagrams: fenced code blocks in the language \`mermaid\` or \`plantuml\` render as diagrams.
- \`[TOC]\` inserts a table of contents and \`[SUBPAGES]\` lists the pages below; \`> [!NOTE]\`, \`[!TIP]\`, \`[!IMPORTANT]\`, \`[!WARNING]\` and \`[!CAUTION]\` start callouts.
- Write for the team: current facts, decisions with their reasons, how-tos. Keep session logs and scratch notes out of the wiki.

## Ground rules

- Edit \`${settingsFile}\` only when asked to.
- Keep task files and pages in their format: people and other tools read them too.
- In the checkout, commit task and wiki edits like code, together with the work they describe.
`;
}

/** The section for AGENTS.md and other instruction files; `skillPath` is where the details are, if anywhere. */
export function section({ wikiRoot, wikiHome, taskRoot, taskPrefix: prefix, settingsFile }: Values, skillPath: string | null): string {
  const details = skillPath
    ? `\n- The \`${SKILL_NAME}\` skill (\`${skillPath}\`) describes the file formats and the workflow in detail.`
    : "";
  return `## Tasks and wiki (Genbeya)

This project plans its work as Genbeya tasks and documents itself in a Genbeya wiki, both plain Markdown files in this repository.

- Use tasks instead of an internal todo list. Tasks are files in \`${taskRoot}/\` named after their ID (\`${prefix}-12.md\`). Create one for work you plan, keep its \`status\` current as you go, and tick its checklist.
- Use the wiki instead of private memory files. Pages are Markdown files in \`${wikiRoot}/\`, starting at \`${wikiRoot}/${wikiHome}\`. Read the relevant pages before you change an area, and record durable project knowledge there.
- \`${settingsFile}\` holds the workflow states, the task prefix and the folders. If \`git worktree list\` shows a worktree inside \`.git/genbeya/\` (\`.git/gitdesk/\` in repositories set up with GitDesk, as Genbeya was called before), its \`.genbeya-content\` file (or \`.gitdesk-content\`) says which areas (\`wiki\`, \`tasks\`, \`settings\`) live there (\`branch\`) and which in the checkout (\`checkout\`); without that file all three live there. Edit and commit an area on the content branch in that worktree.
- Reference tasks, pages and files as \`[[${prefix}-12]]\`, \`[[Page title]]\` or \`[[src/file.ts#L10-L20]]\`, and name the task in commit messages and pull requests.${details}`;
}

/** The section for CLAUDE.md when AGENTS.md has it: Claude Code imports files named with `@`. */
export function agentsImport(): string {
  return "Instructions shared by all coding agents, including how to use the Genbeya tasks and wiki:\n\n@AGENTS.md";
}
