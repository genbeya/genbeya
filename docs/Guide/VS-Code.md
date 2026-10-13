# VS Code

The Genbeya extension for VS Code shows the wiki and the tasks of the repository you have open, next to your code. Pages and tasks are the same Markdown files the app edits, so you can switch between the app and VS Code at any time.

> [!NOTE]
> The extension is an early preview, and not on the Marketplace yet. It covers the wiki and the tasks; for Genbeya's Git tools, use the app.

## Install

1. Download `Genbeya-<version>-vscode.vsix` from the [download page](https://genbeya.fyi/download/#vscode) or the [latest release](https://github.com/genbeya/genbeya/releases/latest).
2. In VS Code, open the **Extensions** view, choose **…** → **Install from VSIX…** and pick the file. Or run `code --install-extension Genbeya-<version>-vscode.vsix`.

It needs VS Code 1.140 or newer, and works in editors built on it, such as VSCodium and Cursor. Install a newer `.vsix` the same way to update.

The extension starts in folders with a `.genbeya.yml`, and whenever you open its views. It shows the first Git repository among the workspace's folders. In WSL, over SSH and in dev containers it runs where the repository is, through VS Code's remote support. It stays off in folders VS Code doesn't trust, because Genbeya runs Git there.

## The Genbeya views

The Genbeya icon in the activity bar opens two views.

**Wiki** lists the pages as a tree. A click opens a page's preview; hover a page for **Preview** and **Edit**, which opens the Markdown file. Right-click a page to add a subpage, move or rename it (Genbeya offers to update the links to it), or delete it.

**Tasks** lists the tasks by workflow state; the folder button in its title bar groups them by epic first. A click opens a task's preview, **Edit** its file.

- Drag tasks onto another state to move them there, or onto an epic to move them into it.
- Right-click a task to change its status, type, priority, assignee, epic or labels, to rename it or to delete it. With several tasks selected, **Status…** moves them all.
- **+** creates a task, of a type from its template if you pick one.

When the repository keeps content on a [content branch](../Architecture/Content-branch.md), the views' titles show the branch and how many edits it is ahead (↑) and behind (↓), and the sync button exchanges them with the remote.

## Previews

A preview shows a page or task as the app does: [references](References.md) with live titles and states, callouts, diagrams, math, embedded lines of files. Every page and task opens in its own tab, so the editor's tabs and **Go Back** work as they do for files, and VS Code reopens them after a restart.

- Links to pages and tasks open their previews; links to other files open them in the editor, with the lines selected for `#L10-L20`.
- Tick a checklist item to tick it in the file.
- **Edit** in the tab's title bar opens the file. While the file is open, the preview follows what you type.

A task's preview works like the task panel in the app:

- Click the title or a property (status, type, priority, assignee, epic, labels) to change it with VS Code's pickers.
- Custom fields are inputs below the properties.
- Write comments at the end; `Ctrl+Enter` sends. Your own comments have **Edit** and **Delete**.
- **Activity** shows who changed what, from the Git history.

## The board

The board button in the **Tasks** view's title bar opens the board: a column per workflow state, with the same filters as in the app (text, assignee, label, priority, type, epic) and **Swimlanes**, a lane per epic. It remembers them.

- Drag cards between columns, and between lanes to move a task into another epic.
- **+** in a column creates a task in that state.
- Click a card for the task in a popup, where everything of its preview works; **Open in Preview** opens its tab.

## In the editor

In the repository's Markdown files, VS Code's editor knows Genbeya's syntax:

| Type | You get |
| --- | --- |
| `[[` | Tasks by ID and title, pages by title, files by path; see [References](References.md) |
| `@` | The repository's people; see [Writing pages](Writing.md) |
| `//` | Dates, such as `//tomorrow` or `//next friday` |

A reference shows its task's title and state, or its page's title, when you hover it, and opens with `Ctrl+click`. A reference to something that doesn't exist is underlined as a warning. The same completion works in the comment box of a task's preview.

**Open Preview to the Side**, in the title bar of a page or task, opens its preview beside the editor; it scrolls along as you scroll the file.

## Not yet

- Genbeya's Git tools ([[GENBEYA-24]]): use VS Code's Source Control, or the app.
- A Marketplace and Open VSX listing, with updates in VS Code ([[GENBEYA-25]]).
- Several repositories in one window: only the first is shown.

How the extension is built is in [VS Code](../Architecture/VS-Code.md).
