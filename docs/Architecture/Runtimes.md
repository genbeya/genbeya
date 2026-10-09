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

**Electron**: the largest download, and Chromium updates come with the app. In exchange the best isolation (managers in their own process, sandboxed renderer, navigation guard), the same engine on every OS, and the end-to-end tests run against it.

**Tauri**
- The managers run in the webview, so the page has file and process access through the Rust commands. Processes are limited to `git`, `ssh` and `wsl`, but file paths are not scoped yet. The content security policy and the Markdown allowlist are what keeps repository content from using it. Keeping a process boundary means moving the managers into a sidecar process or porting them to Rust.
- Linux renders with WebKitGTK, which is slower and less complete than Chromium; macOS uses WKWebView. Both need testing with the editor, diagrams and drag and drop.
- No jump list or window size memory yet.

**Deno Desktop**
- Labelled experimental. No folder dialog (the shell calls PowerShell, `osascript` or `zenity`), no theme override, no shell-level navigation guard, no single-instance or jump list support. It is packaged with all permissions (`-A`).
- Writes its WebView2 profile next to the executable, which fails in a read-only install location such as `Program Files`.
- Ships its own runtime, so the size win is small, and it uses the most memory of the three.

## Trying the builds

Every push to an `experiment/**` branch runs the *Runtime comparison* workflow. Each run has one artifact per runtime and platform, such as `GitDesk-tauri-macOS`:

| Runtime | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Electron | `.exe` installer | `.dmg` | `.AppImage` |
| Tauri | `.exe` and `.msi` installers | `.dmg` | `.deb`, `.rpm`, `.AppImage` |
| Deno Desktop | `.tar.gz` with the app folder | `.tar.gz` with the `.app` | `.tar.gz` with the executable |

The builds are unsigned: on Windows choose *More info → Run anyway*; on macOS open the app once with right-click → *Open*; on Linux `chmod +x` the AppImage.

The Electron build installs as "GitDesk" and replaces the version from `main`. Tauri installs as "GitDesk Tauri" with its own settings (`dev.gitdesk.tauri`), and Deno runs from its folder, so both can be used next to it. To build locally, see [[Development]].
