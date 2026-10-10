# GitDesk

A desktop workspace for a Git repository: wiki, task board, code editor and version control in one window. Everything is a plain file in the repository — Markdown pages, one Markdown file per task, and `.gitdesk.yml` for settings — so it works with any Git host and any other tool.

- **Wiki** with nested pages, `[[wiki links]]`, `[TOC]`, subpage listings, callouts, Mermaid and PlantUML diagrams (rendered locally by [rockuml](https://github.com/h3ll5ur7er/rockuml)), syntax highlighting, and a side-by-side editor.
- **Tasks** on a board or list, with readable IDs (`GENBEYA-12`), drag and drop, inline status/priority/assignee/labels, and rendered descriptions with clickable checkboxes.
- **Code, changes and history**: CodeMirror editor, staging, commit and amend, fetch/pull/push, branch switching, and a commit graph.
- **Local, WSL and SSH** repositories. Git runs where the repository is.
- **Shared content branch** (optional): keep the wiki, the tasks or the settings, each on its own, on a shared `gitdesk` branch so they look the same on every code branch.
- **Terminal** (`` Ctrl+` ``) in the repository, on the machine it lives on.
- **AI agents**: a skill and an `AGENTS.md` section teach Claude Code, Codex, Copilot, Cursor and others to track their work as tasks and keep project knowledge in the wiki ([AI agents](docs/Guide/AI-agents.md)).
- Command palette (`Ctrl+K`), back/forward (`Alt+←/→`, mouse buttons), recent repositories, dark and light themes.

## Run

Requires Node.js 24 and Git.

```bash
npm install
npm start
```

Open this folder in GitDesk: its wiki documents the app and its task board is the real backlog.

## Download

Every push to `main` publishes a [release](https://github.com/h3ll5ur7er/gitdesk/releases) with every installer as its own file, named `GitDesk-<version>-<variant>-<os>-<arch>`. GitDesk comes in three variants that can be installed side by side (see [Runtimes](docs/Architecture/Runtimes.md)):

| Variant                                                        | Windows                | macOS                                             | Linux                         |
| -------------------------------------------------------------- | ---------------------- | ------------------------------------------------- | ----------------------------- |
| **Electron** (recommended; bundled Chromium, largest)          | `-setup.exe`           | `.dmg`, Apple silicon (`arm64`) and Intel (`x64`) | `.AppImage`                   |
| **Tauri** (small, system webview; installs as "GitDesk Tauri") | `-setup.exe` or `.msi` | `.dmg`, Apple silicon                             | `.AppImage`, `.deb` or `.rpm` |
| **Deno Desktop** (experimental; installs as "GitDesk Deno")    | `.msi`                 | `.dmg`, Apple silicon                             | `.AppImage` or `.deb`         |

Pull requests and `experiment/**` branches build the same installers as workflow artifacts.

The builds are unsigned. On Windows, choose _More info → Run anyway_; on macOS, open the app the first time with right-click → _Open_ or run `xattr -dr com.apple.quarantine /Applications/GitDesk.app`; on Linux, `chmod +x` the AppImage.

## Documentation

The documentation lives in [`docs/`](docs/Home.md) and is best read in GitDesk itself:

- [Getting started](docs/Getting-started.md)
- [Guide](docs/Guide.md): [wiki](docs/Guide/Wiki.md), [tasks](docs/Guide/Tasks.md), [version control](docs/Guide/Version-control.md), [terminal](docs/Guide/Terminal.md), [shortcuts](docs/Guide/Keyboard-shortcuts.md)
- [Architecture](docs/Architecture.md): [managers](docs/Architecture/Managers.md), [hosts](docs/Architecture/Hosts.md), [content branch](docs/Architecture/Content-branch.md), [security](docs/Architecture/Security.md), [runtimes](docs/Architecture/Runtimes.md)
- [Development](docs/Development.md): scripts, tests, conventions

## Built with

Angular 22, CodeMirror 6, unified/remark, rockuml and Mermaid in the client; plain TypeScript managers on Node (Electron, Deno Desktop) or in the webview with Rust file and process commands (Tauri). See [Architecture](docs/Architecture.md).
