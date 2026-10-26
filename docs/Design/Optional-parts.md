# Optional parts

> [!NOTE]
> Proposal, not built yet. Tasks: [[GENBEYA-39]], [[GENBEYA-40]], [[GENBEYA-41]].

Not every project wants a wiki, a task board or planning, and not every person wants to see all of them. Each part of the app can be turned off, and the interface leaves it out.

**Decided:** every user can turn parts of the app on and off, and this comes before new features such as [Planning](Planning.md) and [Pull requests](Pull-requests.md), so they are built switchable from the start. Being removable keeps a feature behind a clean boundary instead of leaking into the rest of the app.

[TOC]

## Two layers

Turning a part off means two different things, so there are two layers:

| Layer | Stored in | Means |
| --- | --- | --- |
| **The project uses** | `.genbeya.yml` | The project works without this part. Nobody sees it, and the agent instructions, onboarding and search leave it out. Team policies, such as whether effort is logged, belong here too. |
| **I show** | Personal preferences, per repository, with a default for all repositories | I don't want to see this part. It is hidden for me only; files and other people are not affected. |

A part shows when the project uses it and I show it. The project layer saves a team that doesn't plan in tasks from turning the board off in every clone, and keeps coding agents from being told to plan in `tasks/` when nobody does. The user layer is what each person tidies for themselves.

A possible shape in `.genbeya.yml`, listing what the project does not use, so that a missing key means everything is on:

```yaml
unused: [wiki, planning]
```

## Parts

Parts are the areas of the app and a few features within them, not every button:

| Part | Contains | Needs |
| --- | --- | --- |
| Wiki | The **Wiki** view | — |
| Tasks | The **Tasks** view and the board | — |
| Planning | Planning fields, dependencies, plan macros ([Planning](Planning.md)) | Tasks |
| Time log | Logging effort on tasks | Planning |
| Code | The **Code** view | — |
| Changes, History | The version control views | — |
| Terminal | The terminal | — |
| Pull requests | The pull request view ([Pull requests](Pull-requests.md)) | — |

A part that another needs can't be turned off alone; the settings say what else goes with it. Pull requests reuse the diff viewer of **Changes**, but as a building block, so hiding **Changes** doesn't hide them.

A settings page of forty switches would be bloat of its own, so the list stays this short.

## What turning a part off does

- **Sidebar, palette and shortcuts:** the view disappears from the sidebar and the `Ctrl+K` palette. `Ctrl+1` … `Ctrl+5` keep their views and skip hidden ones, so muscle memory survives.
- **Search** leaves hidden parts out.
- **References into a hidden part** still resolve and show their title: `[[A page]]` in a task stays a link and opens a read-only preview, not a broken link.
- **Files are never touched.** Turning the wiki off doesn't delete `docs/`, and turning it on again shows everything as before.
- **Agent instructions** (project layer only): the generated `AGENTS.md` section and skill leave out what the project doesn't use.
- **VS Code:** VS Code already lets everyone hide views, so the extension only follows the project layer.

## Defaults

- Existing users see everything they see today.
- A part can switch itself on when the project clearly uses it, and stay out of the way when it doesn't: Tasks when the task folder exists, Planning when planning fields are configured, Pull requests when pull request files exist. New users then see what their project actually has.

## Loading only what is shown

Hiding is a matter of the client. The backend still builds a snapshot of everything (pages, tasks, settings) when a repository opens. Loading each area only when it is shown would make turning parts off save memory and time too, which matters for large repositories over SSH. That is a refactor of its own ([[GENBEYA-41]]) and can follow the switches.

## Open questions

- Is listing unused parts (`unused:`) clearer than listing used ones?
- Do the personal switches apply per repository by default, or for all repositories unless a repository overrides them?
- Is a hidden part reachable through a reference or a shared link, read-only, or not at all?
