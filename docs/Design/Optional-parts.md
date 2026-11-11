# Optional parts

> [!NOTE]
> A first prototype is built ([[GENBEYA-39]], [[GENBEYA-40]]); see [The prototype](#the-prototype) for what it does and what is left. How to use it: [Turning parts off](../Guide/Settings.md#turning-parts-off). Loading only what is shown ([[GENBEYA-41]]) is still open.

Not every project wants a wiki, a task board or planning, and not every person wants to see all of them. Each part of the app can be turned off, and the interface leaves it out.

**Decided:** every user can turn parts of the app on and off, and this comes before new features such as [Planning](Planning.md) and [Pull requests](Pull-requests.md), so they are built switchable from the start. Being removable keeps a feature behind a clean boundary instead of leaking into the rest of the app.

[TOC]

## The prototype

What the first version answers, to try out before deciding for good:

- **The key** is `unused: [wiki, planning]` in `.genbeya.yml`: listing what is off, so a missing key means everything is on and nothing changes for existing projects.
- **The parts** are `wiki`, `tasks`, `planning`, `timelog`, `code`, `changes`, `history`, `pulls` and `terminal`. Planning needs tasks and the time log needs planning; turning one off takes those along, and turning one on brings back what it needs.
- **The user layer** is `hiddenParts` in the personal preferences: a list for every repository, and lists for single repositories, which win. **Settings → App → Show** switches between **This repository** and **Every repository**.
- **Hidden parts** leave the sidebar, the palette (views, commands, pages, tasks, files), full-text search results and the tour. `Ctrl+1` … `Ctrl+6` keep their numbers. A repository opens in the first view that shows.
- **References** into a hidden part still open it: hidden is out of the way, not locked.
- **Agent files** leave an unused wiki or task board out, and say what `unused` means; with nothing unused, they are byte for byte what they were.
- **VS Code** hides the wiki and task views of a project that doesn't use them.
- **Where it lives:** the parts and their needs are in `src/contracts/model.ts`, the client's view of them in `src/client/app/core/parts.ts`.

Left for later:

- Parts switching themselves on when the project clearly uses them, for new users.
- A read-only preview for references into a hidden part, if a hidden part should be harder to reach.
- Onboarding beyond the tour, and plan macros in VS Code's preview.
- Loading only what is shown ([[GENBEYA-41]]).

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

- **Sidebar, palette and shortcuts:** the view disappears from the sidebar and the `Ctrl+K` palette. `Ctrl+1` … `Ctrl+6` keep their views and skip hidden ones, so muscle memory survives.
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

- Is listing unused parts (`unused:`) clearer than listing used ones? The prototype lists unused ones.
- Do the personal switches apply per repository by default, or for all repositories unless a repository overrides them? The prototype applies them to every repository unless the repository has a choice of its own.
- Is a hidden part reachable through a reference or a shared link, read-only, or not at all? The prototype keeps it reachable.
