# GitDesk

A desktop workspace for a Git repository: wiki, task board, code editor and version control in one window. Everything is a plain file in the repository — Markdown pages, one Markdown file per task, and `.gitdesk.yml` for settings — so it works with any Git host and any other tool.

- **Wiki** with nested pages, `[[wiki links]]`, `[TOC]`, subpage listings, callouts, Mermaid and PlantUML diagrams, syntax highlighting, and a side-by-side editor.
- **Tasks** on a board or list, with readable IDs (`GENBEYA-12`), drag and drop, inline status/priority/assignee/labels, and rendered descriptions with clickable checkboxes.
- **Code, changes and history**: Monaco editor, staging, commit and amend, fetch/pull/push, branch switching, and a commit graph.
- **Local, WSL and SSH** repositories. Git runs where the repository is.
- **Dedicated content branch** (optional): keep wiki and tasks on a shared `gitdesk` branch so they look the same on every code branch.
- Command palette (`Ctrl+K`), back/forward (`Alt+←/→`, mouse buttons), recent repositories, dark and light themes.

## Run

Requires Node.js 24 and Git.

```bash
npm install
npm run dev
```

Open this folder in GitDesk: its wiki documents the app and its task board is the real backlog.

## Download

Every push to `main` publishes a [release](https://github.com/h3ll5ur7er/gitdesk/releases) with installers for Windows (`.exe`), macOS (`.dmg`, Intel and Apple silicon) and Linux (`.AppImage`). Pull requests build the same installers as workflow artifacts.

The builds are unsigned. On Windows, choose _More info → Run anyway_; on macOS, run `xattr -dr com.apple.quarantine /Applications/GitDesk.app` after installing.

## Documentation

The documentation lives in [`docs/`](docs/Home.md) and is best read in GitDesk itself:

- [Getting started](docs/Getting-started.md)
- [Guide](docs/Guide.md): [wiki](docs/Guide/Wiki.md), [tasks](docs/Guide/Tasks.md), [version control](docs/Guide/Version-control.md), [shortcuts](docs/Guide/Keyboard-shortcuts.md)
- [Architecture](docs/Architecture.md): [engine](docs/Architecture/Engine.md), [hosts](docs/Architecture/Hosts.md), [content branch](docs/Architecture/Content-branch.md), [security](docs/Architecture/Security.md)
- [Development](docs/Development.md): scripts, tests, conventions
