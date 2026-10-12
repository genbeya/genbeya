# Runtimes

The same Angular client and the same managers run in three shells, so the runtime can be chosen on measurements instead of opinions.

| | Where the managers run | Webview on Windows / macOS / Linux |
| --- | --- | --- |
| **Electron** (`src/shells/electron/`) | Node main process | Bundled Chromium everywhere |
| **Deno Desktop** 2.9 (`src/shells/deno/`) | Deno process, on Deno's Node compatibility | WebView2 (Chromium) / WKWebView / WebKitGTK |
| **Tauri** 2 (`src/shells/tauri/`) | In the webview, with Rust commands for files and processes | WebView2 (Chromium) / WKWebView / WebKitGTK |

## Results (Windows 11 x64)

Memory is the private working set of the app's whole process tree (Task Manager's "Memory"), including the WebView2 processes. Each value is the median of three launches with this repository open: idle on the wiki ten seconds after start, then again after visiting tasks, code (with `workspace.ts` open in the editor), changes, history and back to the wiki. Launch time runs until the restored repository is on screen.

| | React on Electron (main) | Angular on Electron | Angular on Tauri | Angular on Deno Desktop |
| --- | ---: | ---: | ---: | ---: |
| Download | 110 MB | 113 MB | **8.1 MB** | 38 MB (.msi) |
| Installed | 387 MB | 387 MB | **10 MB** ¹ | 95 MB ¹ |
| Memory, idle on the wiki | 139 MB | **120 MB** | 127 MB | 139 MB |
| Memory, after visiting every view | 249 MB | **151 MB** | 162 MB | 167 MB |
| Launch to restored repository | 678 ms | **614 ms** | 702 ms | 691 ms |

¹ Plus the WebView2 runtime, which ships with Windows 10 and 11.

The Angular client is 613 kB of initial JavaScript (120 kB compressed). Mermaid (loaded on first use) and rockuml's WebAssembly engine make up most of the 18 MB client folder.

## What this means

**The rewrite pays off on every runtime.** Replacing Monaco with CodeMirror and loading diagrams on demand saves about 100 MB once the code view has been used, and the app starts faster.

**Size: Tauri wins by a factor of 14.** Electron ships a Chromium build; Tauri ships a 10 MB executable and borrows the system webview. Deno sits in between because it ships its own runtime.

**Memory on Windows: no real difference between runtimes.** WebView2 *is* Chromium, so all three run the same engine; Electron is even slightly ahead. On macOS and Linux the system webview is WebKit, which tends to need less memory but renders differently; that is not measured here.

## What each runtime costs

**Electron**: the largest download, and Chromium updates come with the app. In exchange the best isolation (managers in their own process, sandboxed renderer, navigation guard), the same engine on every OS, and the end-to-end tests run against it. The [Terminal](../Guide/Terminal.md) uses node-pty, a native module that ships unpacked next to the app archive.

**Tauri**
- The managers run in the webview, so the page has file and process access through the Rust commands. Processes are limited to `git`, `ssh` and `wsl`, terminals to the user's shell, `wsl` and `ssh` (portable-pty), but file paths are not scoped yet. The content security policy and the Markdown allowlist are what keeps repository content from using it. Keeping a process boundary means moving the managers into a sidecar process or porting them to Rust.
- Linux renders with WebKitGTK, which is slower and less complete than Chromium; macOS uses WKWebView. Both need testing with the editor, diagrams and drag and drop.
- No jump list or window size memory yet.

**Deno Desktop**
- Labelled experimental. No folder dialog (the shell calls PowerShell, `osascript` or `zenity`), no theme override, no shell-level navigation guard, no single-instance or jump list support. It is packaged with all permissions (`-A`).
- No handler for `genbeya://` links: Deno Desktop cannot register a URL scheme with the operating system, so links are pasted into the command palette. Electron registers the scheme when the installed app starts, Tauri through its installers (and AppImages at start), both through the single-instance hand-over for a running app.
- Would write its WebView2 profile next to the executable, which is read-only once installed. Deno Desktop creates the webview before the app's code runs and has no setting for the profile folder, so on Windows the app starts itself again with `WEBVIEW2_USER_DATA_FOLDER` pointing to `%LOCALAPPDATA%\Genbeya Deno\WebView2` (`src/shells/deno/main.ts`). The variable must be the running user's, so it cannot be set at build time.
- No [Terminal](../Guide/Terminal.md). node-pty loads under Deno's Node compatibility, but on Windows it opens its ConPTY pipes with `fs` calls Deno rejects, and `deno desktop` cannot bundle a native module. The shell gives the managers a machine without terminals, and the panel says so.
- Ships its own runtime, so the size win is small, and it uses the most memory of the three.

## Trying the builds

Every push to `main` publishes one GitHub release with all variants for all platforms; pushes to `experiment/**` branches and pull requests build the same files as workflow artifacts, one per runtime and platform, such as `Genbeya-tauri-macOS`. Each installer is named `Genbeya-<version>-<variant>-<os>-<arch>`:

| Runtime | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Electron | `electron-windows-x64-setup.exe` | `electron-macos-arm64.dmg`, `electron-macos-x64.dmg` | `electron-linux-x64.AppImage` |
| Tauri | `tauri-windows-x64-setup.exe`, `tauri-windows-x64.msi` | `tauri-macos-arm64.dmg` | `tauri-linux-x64.AppImage`, `.deb`, `.rpm` |
| Deno Desktop | `deno-windows-x64.msi` | `deno-macos-arm64.dmg` | `deno-linux-x64.AppImage`, `.deb` |

The builds are unsigned: on Windows choose *More info → Run anyway*; on macOS open the app once with right-click → *Open*; on Linux `chmod +x` the AppImage.

The Electron build installs as "Genbeya". Tauri installs as "Genbeya Tauri" with its own settings (`fyi.genbeya.tauri`), and Deno Desktop as "Genbeya Deno" with its own settings folder, so all three can be used side by side. To build locally, see [Development](../Development.md).

## Updating from GitDesk

Genbeya was called GitDesk before 0.5. Windows installers find an installed app by an identity derived from its name, so each variant keeps the identity of its GitDesk predecessor where that decides whether an installer upgrades or installs next to it, and takes the new name everywhere else. Each variant's first start copies its predecessor's recent repositories and preferences (`state.json`, and Electron's window size) into its own data folder, unless that has state already; the old folder stays as it was. Layout choices kept in the webview's storage (panel sizes, board or list) start over.

| Variant | New identity | Kept from GitDesk | On Windows |
| --- | --- | --- | --- |
| Electron | `productName` Genbeya, `appId` `fyi.genbeya.app`, `Genbeya.exe` | The NSIS GUID (`nsis.guid` in `package.json`, `6f35097a-…`, which electron-builder derived from GitDesk's appId `dev.gitdesk.app`) | The installer finds GitDesk, removes it as an older version and keeps its registry entries; shortcuts are renamed. `build/installer.nsh` moves an installation from a folder named `GitDesk` to one named `Genbeya` beside it. Data: `%APPDATA%\GitDesk` is copied to `%APPDATA%\Genbeya` |
| Tauri | `productName` Genbeya Tauri, identifier `fyi.genbeya.tauri` | The MSI's upgrade code (`bundle.windows.wix.upgradeCode`, `b50af3c1-…`, which Tauri derived from "GitDesk Tauri") | The MSI upgrades GitDesk Tauri's. Tauri's NSIS installer keys installations by product name, so a hook (`src-tauri/windows/installer-hooks.nsh`) runs GitDesk Tauri's uninstaller silently first, which keeps its data. Data: the folder of `dev.gitdesk.tauri` is copied to that of `fyi.genbeya.tauri` |
| Deno Desktop | Genbeya Deno, `genbeya-deno` | — (`deno desktop` derives the MSI's upgrade code from the name) | `scripts/msi-major-upgrade.ps1` adds GitDesk Deno's upgrade code, `{F1362F28-64FF-530A-B5CF-AFA16603621A}`, to the Upgrade table: the MSI removes GitDesk Deno like an older version of itself, and refuses to install over a newer one. Data: `%APPDATA%\GitDesk Deno` is copied to `%APPDATA%\Genbeya Deno`; the WebView2 profile is not, as it holds caches and storage for an origin that changes with every start |

On macOS and Linux the apps install under their new names next to the old ones, which users remove themselves. All variants still open the `gitdesk://` links GitDesk made, and Electron and Tauri register both schemes.
