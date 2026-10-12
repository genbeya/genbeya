<p align="center"><img src="branding/genbeya.svg" width="160" alt="Genbeya"></p>

# Genbeya

A desktop workspace for one Git repository: a wiki, a task board, a code editor, Git tools and a terminal in one window. Everything it shows is a plain file in the repository — Markdown pages, one Markdown file per task, `.genbeya.yml` for settings — so it works with any Git host, any editor and any coding agent. No server, no account, no database.

Genbeya's future home is [genbeya.fyi](https://genbeya.fyi); until then, everything lives here.

![Genbeya's wiki, showing references to pages, a task and a file, and an embed of a file's lines](docs/images/wiki-references.png)

## Features

- **Wiki** — nested pages with a live-preview editor, tables of contents, callouts, Mermaid and PlantUML diagrams (rendered locally by [rockuml](https://github.com/h3ll5ur7er/rockuml)) and images from the repository.
- **References** — `[[GENBEYA-12]]`, `[[Page title]]` or `[[src/app.ts#L10-L20]]` link tasks, pages and files and show their live title and status; `![[file#L1-L9]]` embeds the current lines of a file. Missing pages show red, and moving a page rewrites the links to it. ([More](docs/Guide/References.md))
- **Tasks** — a board or a list with readable IDs, drag and drop, task types, custom fields, description templates, epics as folders and swimlanes, comments, and activity read from Git history.
- **Code** — a CodeMirror editor with find and replace, several cursors, folding, coloured bracket pairs and a minimap.
- **Search** — full-text search across pages, tasks and code (`Ctrl+Shift+F`), powered by `git grep`.
- **Version control** — stage, commit and amend; branches, tags and stashes; merge, rebase (also interactively), cherry-pick and revert, with conflict resolution in the app; a commit graph of every branch.
- **Terminal** — a shell in the repository (`` Ctrl+` ``), on the machine it lives on.
- **Anywhere** — repositories on this computer, in WSL or over SSH, with a remote folder browser. Git runs where the repository is.
- **Content branch** (optional) — keep the wiki, the tasks or the settings, each on its own, on a shared branch, so they look the same on every code branch.
- **Sharing** — copy a link that opens a page, task, file or commit in a coworker's Genbeya, or on GitHub, GitLab, Bitbucket or Azure DevOps.
- **AI agents** — a skill and an `AGENTS.md` section teach Claude Code, Codex, Copilot, Cursor and others to track their work as tasks and keep project knowledge in the wiki.
- **Onboarding** — a sample project, a guided tour, and what's new after each update. Command palette (`Ctrl+K`), back and forward, dark and light themes.

## Why Genbeya?

Genbeya joins two words from lean manufacturing: **genba** (現場, "the real place", where value is actually created; lean's advice is to go to the genba instead of reading reports elsewhere) and **obeya** (大部屋, "big room", the project room where plans, tasks, problems and status hang on the walls for everyone to see). Genbeya is the big room at the real place: everything about a project — docs, tasks, decisions, code and history — kept right where the work happens, in the repository: versioned, reviewable, and available to every tool and person that can read files.

It is pronounced "gen-BEH-ya".

## Download

Every push to `main` publishes a [release](https://github.com/genbeya/genbeya/releases/latest) with an installer per variant and system, named `Genbeya-<version>-<variant>-<os>-<arch>`. The three variants are the same app on different runtimes and install side by side:

| Variant                         | Size    | Differences                                                                           | Windows                | macOS                           | Linux                         |
| ------------------------------- | ------- | ------------------------------------------------------------------------------------- | ---------------------- | ------------------------------- | ----------------------------- |
| **Electron** (recommended)      | ~110 MB | Bundled Chromium: the same everywhere, the most tested                                | `-setup.exe`           | `.dmg`, Apple silicon and Intel | `.AppImage`                   |
| **Tauri**                       | ~8 MB   | System webview; installs as "Genbeya Tauri"                                           | `-setup.exe` or `.msi` | `.dmg`, Apple silicon           | `.AppImage`, `.deb` or `.rpm` |
| **Deno Desktop** (experimental) | ~38 MB  | System webview; no terminal, no `genbeya://` link handler; installs as "Genbeya Deno" | `.msi`                 | `.dmg`, Apple silicon           | `.AppImage` or `.deb`         |

A newer installer replaces the installed version of its variant. The builds are unsigned: on Windows choose _More info → Run anyway_; on macOS open the app the first time with right-click → _Open_ (or run `xattr -dr com.apple.quarantine /Applications/Genbeya.app`); on Linux `chmod +x` the AppImage. Genbeya needs Git on the machine that holds the repository.

## Documentation

The documentation is Genbeya's own wiki, in [`docs/`](docs/Home.md). It reads best in Genbeya, where its references and examples are live.

- [Getting started](docs/Getting-started.md): install, open a repository, the sample project and the tour
- [Guide](docs/Guide.md): [wiki](docs/Guide/Wiki.md), [references](docs/Guide/References.md), [tasks](docs/Guide/Tasks.md), [code](docs/Guide/Code.md), [search](docs/Guide/Search.md), [version control](docs/Guide/Version-control.md), [terminal](docs/Guide/Terminal.md), [sharing](docs/Guide/Sharing.md), [AI agents](docs/Guide/AI-agents.md), [keyboard shortcuts](docs/Guide/Keyboard-shortcuts.md), [settings](docs/Guide/Settings.md)
- [Architecture](docs/Architecture.md): [managers](docs/Architecture/Managers.md), [hosts](docs/Architecture/Hosts.md), [content branch](docs/Architecture/Content-branch.md), [runtimes](docs/Architecture/Runtimes.md), [security](docs/Architecture/Security.md)
- [Development](docs/Development.md): build, test, package and release

## Run from source

Requires Node.js 24 and Git.

```bash
npm install
npm start
```

Open this folder in Genbeya: its wiki documents the app and its task board is the real backlog. See [Development](docs/Development.md) for tests and packaging.

## Built with

Angular, CodeMirror 6, unified/remark, rockuml and Mermaid in the client; plain TypeScript managers on Node (Electron, Deno Desktop) or in the webview with Rust file and process commands (Tauri). See [Architecture](docs/Architecture.md).

## License

Genbeya is [fair source](https://fsl.software): its code is public under the [Functional Source License, Version 1.1, ALv2 Future License](LICENSE.md) (FSL-1.1-ALv2).

- **You may** use Genbeya for anything, at home or at work, in companies and on closed-source projects; read, change and build it; and share it, changed or not, with the license attached.
- **You may not** offer Genbeya, or something substantially similar built from it, as a competing commercial product or service.
- **Two years** after each version's release, that version is also licensed under the [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0), without that restriction.
- **What Genbeya writes into your repositories is yours**: the agent skill, the Genbeya block in `AGENTS.md`, `CLAUDE.md` and Copilot's instructions, the sample project, new `.genbeya.yml` files and task templates are under the [MIT License](LICENSE-MIT.md), which lists them and the source files they come from.

The name Genbeya and its logo are not licensed for use as your own product's name or branding; use them to refer to Genbeya.
