---
id: GENBEYA-66
title: Leave the terminal and remote hosts out of the VS Code extension
type: bug
status: review
priority: high
labels: [vscode, release]
---

The Visual Studio Marketplace's automated check refuses the extension within seconds, with "does not align with the Marketplace policy" and no rule named ([[GENBEYA-25]]). The extension builds the desktop app's whole backend, so `extension.cjs` carries code it never runs and that reads like a remote access tool to a pattern scanner: PowerShell started with hidden windows, `taskkill /f`, node-pty, `ssh -t … exec "$SHELL" -l`, `wsl.exe`, and a base64 command-line argument (`--open=`) decoded and opened. VS Code has its own terminal and reaches WSL and SSH itself, and nothing passes the extension launch arguments.

- [x] A backend for repositories on this computer only: no remote hosts, no folder browsing on WSL or SSH, no launch arguments
- [x] The Node machine without terminals unless a shell asks for them; the local shell command comes with the host factory
- [x] The extension uses it; Electron and Deno keep what they have
- [x] The extension build fails when the bundle names PowerShell, taskkill, node-pty, ssh or wsl.exe
- [x] Docs: [[Architecture]] and the VS Code page
- [ ] Try the `.vsix` on the Marketplace by hand

### Claude — 2026-11-20 13:44+01:00

The extension now builds `createLocalBackend` (`src/managers/local-backend.ts`) on `nodeMachine()`, which has no terminals unless a shell passes `nodeTerminals` (Electron does; Deno and the extension don't). `LocalHosts` opens repositories on this computer only, and `quote` moved to `src/utilities/shell-quote.ts`, so the remote shell session no longer comes along with the Git access. In the packed `extension.cjs`, PowerShell, `pwsh`, `taskkill`, node-pty, `wsl.exe`, `BatchMode`, `--open=`, `mktemp` and `exec "$SHELL"` no longer occur, and the build fails if one comes back. `child_process` stays, for running Git.
