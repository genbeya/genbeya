---
id: GENBEYA-35
title: Quality of life buttons
type: improvement
status: backlog
---

somewhere near the terminal button, we could add some more quality of life buttons:
- Open in VSCode
- Open in file explorer
- Open in <configurable in config>

### Claude — 2026-10-20 14:15+02:00

Nothing like this exists yet. Two technical points shape it:

- **Links are restricted.** The shells only open `http`, `https` and `mailto` links (`openExternal` in `shells/electron/main.ts`), on purpose. "Open in VS Code" needs its own platform call that builds a `vscode://` link from a path, instead of a looser link filter.
- **Where the repository lives matters:**
  - **Locally:** VS Code opens it with `vscode://file/<path>`.
  - **WSL:** `vscode://vscode-remote/wsl+<distro>/<path>`.
  - **SSH:** `vscode://vscode-remote/ssh-remote+<host>/<path>`. These need VS Code's Remote extensions.
  - **File explorer:** works for local and WSL repositories (Explorer opens WSL paths as `\wsl$...`), not over SSH, where the button would be disabled with a reason.

Plan:

- Buttons next to the terminal in the sidebar: **Open in VS Code** and **Show in file explorer**. The same two items go in the context menu of a file in **Code** (VS Code opens it at the current line) and of a page or task.
- **Open in …:** a command template set in **Settings → App**, such as `idea {path}` or `cursor {path}:{line}`, with a name for the button. It is run on this computer for local and WSL repositories.

To decide:

- **Where the custom command lives.** I strongly recommend the user's preferences, not `.genbeya.yml`. A command in the repository would run whatever a cloned repository puts there when someone clicks the button.
- **Which editors.** Should Cursor and VSCodium get their own buttons? They take the same kind of links (`cursor://`, `vscodium://`). Or is a single editor choice enough?
