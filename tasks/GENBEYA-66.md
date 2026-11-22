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
- [x] Probe which part the Marketplace refuses: the keywords
- [x] The manifest without keywords
- [x] Display name "Genbeya for VS Code": the removed probe keeps "Genbeya" reserved
- [x] Try the `.vsix` on the Marketplace by hand: accepted as "Genbeya for VS Code"

### Claude — 2026-11-20 13:44+01:00

The extension now builds `createLocalBackend` (`src/managers/local-backend.ts`) on `nodeMachine()`, which has no terminals unless a shell passes `nodeTerminals` (Electron does; Deno and the extension don't). `LocalHosts` opens repositories on this computer only, and `quote` moved to `src/utilities/shell-quote.ts`, so the remote shell session no longer comes along with the Git access. In the packed `extension.cjs`, PowerShell, `pwsh`, `taskkill`, node-pty, `wsl.exe`, `BatchMode`, `--open=`, `mktemp` and `exec "$SHELL"` no longer occur, and the build fails if one comes back. `child_process` stays, for running Git.

### Claude — 2026-11-21 14:58+01:00

The upload of the build without terminals was refused too ("Your extension has suspicious content. Please fix your extension metadata"), so Emanuel uploaded probes under the `genbeya` publisher, each a new extension with empty code:

| Probe | Result |
| --- | --- |
| Empty: one-line README, MIT licence | Accepted |
| All of Genbeya's metadata (manifest, README, changelog, licences, icons) | Refused |
| Each piece alone: display name "Genbeya", contributes, README, changelog, licences, icon | Accepted |
| The plain manifest fields together | Refused |
| `description`, `preview`, `homepage` (genbeya.fyi), each alone | Accepted |
| `keywords` alone (wiki, tasks, kanban, board, markdown, git, documentation, project management, todo) | Refused |
| `pricing`, `author`, `bugs`, `galleryBanner` and `extensionKind` together | Accepted |

So the keywords trip the check; which one is untested. The manifest has none now. The Marketplace blocked uploads for 12 hours after seven or eight new extensions in a row, so the probes stopped there. Accepted probes were removed again.

### Claude — 2026-11-21 17:58+01:00

The build without keywords was refused with "This extension display name is taken": the probe `genbeya.probe-1-name` had been accepted as "Genbeya", and the Marketplace keeps a removed extension's display name reserved. The extension is now "Genbeya for VS Code", the title its README already had; its ID stays `genbeya.genbeya`, and the views still say Genbeya. Support can be asked to release "Genbeya" for `genbeya.genbeya`.
