# Security

The client displays content from repositories you may not fully trust, so it gets as little power as possible.

- **Content security policy**: every shell serves the client with the same policy (`src/shells/content-security-policy.ts`): scripts only from the app itself, no inline scripts, no plugins, no frames, connections only to the app's own origin.
- **Markdown**: raw HTML is not rendered, except `<kbd>`, `<sub>`, `<sup>`, `<br>` and `<details>`/`<summary>` written exactly so, without attributes (`src/client/app/markdown/raw-html.ts`). Pages become a syntax tree that is turned into DOM nodes through an allowlist of elements, attributes and URL schemes (`src/client/app/markdown/markdown-dom.ts`); nothing goes through `innerHTML`.
- **Math**: KaTeX runs with `trust: false` and size and expansion limits, and renders MathML only — no HTML, no inline styles. Its markup is parsed in an inert document and rebuilt through an allowlist of MathML Core elements and presentational attributes (`src/client/app/markdown/mathml.ts`).
- **Diagrams**: PlantUML renders locally with rockuml's WebAssembly engine, Mermaid with `securityLevel: strict`. Both, and SVGs from the repository, are shown as images, so scripts inside them never run.
- **Remote content**: remote images never load implicitly. Nothing is sent to a server.
- **Validated calls**: shells dispatch only the methods listed in `MANAGER_METHODS`, and the managers check every argument again. Repository paths are validated before they reach a host (see [Managers](Managers.md)).
- **Links**: web links open in the system browser, only for `http`, `https` and `mailto`. Dropped files and middle-clicked links never navigate the window.
- **Genbeya links**: `genbeya://open?…` links come from outside (the clipboard, the operating system), so parsing is strict (`src/utilities/genbeya-link.ts`): only the known keys, each once; a remote that names a repository on another machine, never a local path; task IDs and commit hashes of a fixed form; repository paths that pass the path rules. Opening a link only switches to a clone Genbeya already knows (asking about unsaved edits, like any switch) and shows the item; it never runs anything, and cloning waits for the user. Links never carry credentials stored in a remote URL. In Electron they arrive as launch arguments, never as requests: the renderer protocol serves only `genbeya://app`.
- **Git**: commands run without a shell, with hooks and `core.fsmonitor` disabled, terminal prompts off and literal pathspecs. Filters, credential helpers and `core.sshCommand` from the repository's configuration still run on fetch, push and staging, as they would in a terminal.
- **Terminals**: a [Terminal](../Guide/Terminal.md) runs whatever the user types; that is its purpose. What it may start is fixed by the host: the user's own shell (`pwsh.exe`, `powershell.exe` or `COMSPEC` on Windows, `$SHELL` or `/bin/sh` elsewhere), `wsl.exe` or `ssh`. The client chooses none of it — it only names the repository and the terminal's size — and the only variables added to the environment are `TERM` and `COLORTERM`. Terminals end with their repository and when the app quits.

## Per shell

| | Electron | Deno Desktop | Tauri |
| --- | --- | --- | --- |
| Where the managers run | Main process | Deno process | In the webview |
| Client sandbox | Context isolation, sandbox, no Node integration; the preload exposes two IPC calls | Two bindings | Rust commands for files, processes and terminals; processes limited to `git`, `ssh` and `wsl`, terminals to the shells above, each with a fixed set of environment variables |
| Terminal processes | node-pty in the main process, started by the terminal manager | None: the build has no terminal | portable-pty in the Rust process, started through the `term_*` commands; ended on exit |
| Calls accepted from | The app's own page only (sender checked) | The window's page | The window's page |
| Navigation, pop-ups, permissions | Blocked by the shell; only clipboard writes are granted | Blocked by the client only | Navigation outside the app and new windows blocked by the shell |
| Client served from | `genbeya://app`, only files of the bundled client | A local static server, only files of the bundled client | Tauri's asset protocol |

> [!IMPORTANT]
> On Tauri the managers share the webview with the client. A script injected into the page could read and write files anywhere, run Git with arbitrary arguments and type into a shell through the Rust commands. The policy and the Markdown allowlist are what prevents that; Electron and Deno keep a process boundary in addition. The terminal commands add no new kind of power — Git with arbitrary arguments can already run programs — so their allowlist keeps them to the shells a user would open anyway, and keeps their environment from changing how those start.
