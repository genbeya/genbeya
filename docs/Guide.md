# Guide

How to work with GitDesk day to day, one area per page.

| Page | Covers |
| --- | --- |
| [Wiki](Guide/Wiki.md) | Pages and subpages, the editor, links, callouts, diagrams and images |
| [References](Guide/References.md) | `[[…]]` links to tasks, pages and files, line ranges, embeds, and what happens when things move |
| [Writing pages](Guide/Writing.md) | `@mentions` of people, dates, math, code blocks with titles and line numbers, foldable callouts, footnotes, keys and collapsible sections, and inserting blocks with `/` |
| [Tasks](Guide/Tasks.md) | The board and the list, the task file, comments, activity, epics, workflow states, types, templates and custom fields |
| [Code](Guide/Code.md) | The editor: find and replace, several cursors, folding, the minimap |
| [Search](Guide/Search.md) | Finding text in pages, tasks and code |
| [Version control](Guide/Version-control.md) | Changes, stashes, branches, tags, merging, rebasing, cherry-pick, revert, conflicts and history |
| [Terminal](Guide/Terminal.md) | A shell in the repository, locally, on WSL or over SSH |
| [Sharing](Guide/Sharing.md) | Links that open a page, task, file or commit in a coworker's GitDesk or on the Git host |
| [AI agents](Guide/AI-agents.md) | Teaching coding agents to plan in tasks and document in the wiki |
| [Keyboard shortcuts](Guide/Keyboard-shortcuts.md) | Every key, in the app and in the editor |
| [Settings](Guide/Settings.md) | The Settings view and every key of `.gitdesk.yml` |

## The window

The sidebar on the left switches between the five views of the open repository — **Wiki**, **Tasks**, **Code**, **Changes** and **History** (`Ctrl+1` … `Ctrl+5`). Above them, the repository menu opens, clones and switches repositories; below them sit the current branch, the **Terminal** and **Settings**.

## Moving around

- `Ctrl+K` jumps to a page, task or file by name, or runs a command such as switching branch, merging or pushing. Paste a GitDesk link there to open it.
- `Ctrl+Shift+F`, or `/` at the start of the `Ctrl+K` palette, finds text inside pages, tasks and code — see [Search](Guide/Search.md).
- `Alt+←` and `Alt+→`, or the mouse's back and forward buttons, walk through where you have been.
- `/` focuses the filter of the current view, `?` lists the shortcuts.
- `` Ctrl+` `` opens a [Terminal](Guide/Terminal.md) in the repository.
- Right-click a page, task, file or commit for a link to share — see [Sharing](Guide/Sharing.md).

On macOS, use `⌘` where these pages say `Ctrl` (except for the terminal's `` Ctrl+` ``).
