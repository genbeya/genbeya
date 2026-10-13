# VS Code

The VS Code extension (`src/shells/vscode/`) is a fourth shell. It doesn't host the Angular client: the managers run in VS Code's extension host, native tree views list the pages and the tasks, and two small webviews show what trees can't: a **preview** that renders a page or a task as the app does, and the **board**. Pages and tasks open in VS Code's own editor to edit them. The work is tracked in [[GENBEYA-21]].

```mermaid
flowchart LR
  subgraph VSCode["VS Code"]
    views[Wiki and Tasks views] --> session[Repository: snapshot, polled]
    webviews[Preview and board webviews] -- messages --> panels[Webviews]
    editor[Editor] -- "genbeya-content:" --> files[Content file system]
  end
  session --> managers[Managers]
  panels --> managers
  files --> managers
  managers --> node[Node platform]
```

| File | What it does |
| --- | --- |
| `extension.ts` | Activation: creates the managers on the Node platform (preferences in the extension's global storage), opens the first workspace folder that holds a Git repository, registers the views and commands |
| `repository.ts` | The open repository: its snapshot, polled every four seconds while the window has focus, and on focus and save, like the client polls it |
| `wiki-view.ts` | The page tree. A click opens the preview; the inline actions are **Preview** and **Edit** |
| `tasks-view.ts`, `task-groups.ts` | The tasks as a tree, one group per workflow state, with the same actions; dragging tasks onto a state, or **Move to…**, updates their status. The title bar opens the board |
| `webviews.ts` | The preview and the board panels: what they show, and the links, edits, moves and checkbox toggles they report |
| `webview/` | The webviews' code, bundled for the browser: the message protocol, the Markdown renderer, the task view, the preview, the board, and styles from the app's tokens over VS Code's theme |
| `content-files.ts` | The `genbeya-content` file system, for areas on the [Content branch](Content-branch.md) |
| `manifest.json` | The extension's `package.json`; `scripts/build-vscode.mjs` adds the app's version |
| `test/smoke.ts` | The smoke test, run inside VS Code |

## Preview and board

The preview shows one page or task at a time, reused like VS Code's preview tabs: links to pages and tasks open in it, links to other files open in the editor (with the lines of `#L10-L20` selected), web links in the browser after VS Code asks. While the document is open in the editor, the preview follows its unsaved text. **Edit** in the preview's title bar opens the file. Ticking a checklist item saves the file; while its editor has unsaved changes, the preview asks to save first.

The board has a column per workflow state, leaving out the hidden columns. Cards drag between columns, which moves the task as the tree does. A click opens the task's preview in a popup, with its status, **Edit** and **Open in Preview**.

Both render Markdown with the client's own pipeline (`src/client/app/markdown/`: parsing, the allowlisted DOM builder, references, mentions, dates, embeds) and draw Mermaid, PlantUML (rockuml's WebAssembly) and KaTeX themselves, loaded on first use. Markdown never becomes HTML, as in the app ([Security](Security.md)). Webviews only render and report clicks; they read nothing themselves. Images and embedded files come from the extension, through the managers, which check every path. Their content security policy allows only the extension's own scripts and styles, data and blob images, and WebAssembly.

## Where files open

An area in the checkout opens as the plain file, so VS Code's Git support, search and other extensions see it as usual. An area on the content branch opens as `genbeya-content:/<path>`: reads and saves go through the content manager, which commits each save on the content branch, as the app does. A save based on a version that changed meanwhile fails instead of overwriting the newer version. Editing the files in `.git/genbeya/` directly would leave the edits uncommitted.

## Remote workspaces

The manifest's `extensionKind` is `workspace`, so VS Code runs the extension where the workspace is: in WSL, over SSH or in a dev container, it runs there, and the managers see a local repository. The desktop app's own WSL and SSH hosts are not needed. Genbeya runs Git in the repository, which can run programs the repository configures, so the extension stays off in untrusted workspaces.

## Decisions

- **One repository, one version.** The extension lives in this repository and reuses the contracts, engines, managers and the client's Markdown rendering directly. It carries the app's version, so `scripts/version.mjs` needs no new file.
- **Native where VS Code has it.** Trees for lists, the editor for editing, quick picks for choices. Webviews only where VS Code has nothing to offer: rendered pages and tasks, and the board. They are small, purpose-built pages with VS Code's colours and fonts, not the app's client, which would duplicate VS Code's editor, Git and terminal.
- **No terminal.** The extension never opens terminals, so node-pty is not packaged.

## Not yet

See the tasks: [[GENBEYA-22]] (references in VS Code's Markdown editor), [[GENBEYA-23]] (editing tasks natively), [[GENBEYA-24]] (Genbeya's Git tools as a view) and [[GENBEYA-25]] (publishing). Only the first Git repository among the workspace folders is shown.
