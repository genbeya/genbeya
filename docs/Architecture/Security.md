# Security

The client displays content from repositories you may not fully trust, so it gets as little power as possible.

- **Content security policy**: every shell serves the client with the same policy (`src/shells/content-security-policy.ts`): scripts only from the app itself, no inline scripts, no plugins, no frames, connections only to the app's own origin.
- **Markdown**: raw HTML is not rendered. Pages become a syntax tree that is turned into DOM nodes through an allowlist of elements, attributes and URL schemes (`src/client/app/markdown/markdown-dom.ts`); nothing goes through `innerHTML`.
- **Diagrams**: PlantUML renders locally with rockuml's WebAssembly engine, Mermaid with `securityLevel: strict`. Both, and SVGs from the repository, are shown as images, so scripts inside them never run.
- **Remote content**: remote images never load implicitly. Nothing is sent to a server.
- **Validated calls**: shells dispatch only the methods listed in `MANAGER_METHODS`, and the managers check every argument again. Repository paths are validated before they reach a host (see [[Managers]]).
- **Links**: web links open in the system browser, only for `http`, `https` and `mailto`. Dropped files and middle-clicked links never navigate the window.
- **Git**: commands run without a shell, with hooks and `core.fsmonitor` disabled, terminal prompts off and literal pathspecs. Filters, credential helpers and `core.sshCommand` from the repository's configuration still run on fetch, push and staging, as they would in a terminal.

## Per shell

| | Electron | Deno Desktop | Tauri |
| --- | --- | --- | --- |
| Where the managers run | Main process | Deno process | In the webview |
| Client sandbox | Context isolation, sandbox, no Node integration; the preload exposes two IPC calls | Two bindings | Rust commands for files and processes; processes limited to `git`, `ssh` and `wsl` with a fixed set of environment variables |
| Calls accepted from | The app's own page only (sender checked) | The window's page | The window's page |
| Navigation, pop-ups, permissions | Blocked by the shell; only clipboard writes are granted | Blocked by the client only | Navigation outside the app and new windows blocked by the shell |
| Client served from | `gitdesk://app`, only files of the bundled client | A local static server, only files of the bundled client | Tauri's asset protocol |

> [!IMPORTANT]
> On Tauri the managers share the webview with the client. A script injected into the page could read and write files anywhere and run Git with arbitrary arguments through the Rust commands. The policy and the Markdown allowlist are what prevents that; Electron and Deno keep a process boundary in addition.
