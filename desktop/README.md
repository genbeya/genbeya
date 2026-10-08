# Runtime experiment: Electron vs. Tauri vs. Deno Desktop

GitDesk packaged three ways from the same renderer and the same `core/` engine, to see what switching away from Electron would actually save.

| | Where the engine runs | Webview on Windows / macOS / Linux |
| --- | --- | --- |
| **Electron** (`electron/`) | Node main process | bundled Chromium everywhere |
| **Deno Desktop** 2.9 (`desktop/deno/`) | Deno process, unchanged code on Deno's Node compatibility | WebView2 (Chromium) / WKWebView / WebKitGTK |
| **Tauri** 2 (`desktop/tauri/`) | in the webview; Rust provides files and processes behind shims of the Node modules the engine imports | WebView2 (Chromium) / WKWebView / WebKitGTK |

Both prototypes are complete enough to measure honestly: the same API scenario (pages, tasks, staging, commits, diffs, content branch worktree, WSL over the shell transport) passes on all three, and the UI tour below runs identically.

## Results (Windows 11 x64)

Memory is the private working set of the app's whole process tree (Task Manager's "Memory"), including the WebView2 processes. Each value is the median of three launches with this repository open.

| | Electron as shipped | Electron, lean | Tauri | Deno Desktop |
| --- | ---: | ---: | ---: | ---: |
| Download | 157 MB | 110 MB | **5.7 MB** | 36 MB (.msi) |
| Installed | 662 MB | 387 MB | **7.9 MB** ¹ | 97 MB ¹ |
| Memory, idle on the wiki | 167 MB | **140 MB** | 145 MB | 158 MB |
| Memory, after visiting every view | 293 MB | **269 MB** | 277 MB | 300 MB |
| Launch to restored repository | 761 ms | **728 ms** | 814 ms | 771 ms |

¹ Plus the WebView2 runtime, which ships with Windows 10 and 11.

"Electron, lean" is today's app with one packaging fix (below). Deno cross-compiles: its macOS `.app` is 85 MB and its Linux `.AppImage` 136 MB. `.github/workflows/runtimes.yml` packages all three runtimes on every platform and reports the sizes.

## What this means

**Size: the switch pays off.** Electron ships a Chromium build (the executable alone is 235 MB unpacked); Tauri ships an 8 MB executable and borrows the system webview. Deno sits in between because it ships its own runtime.

**Memory on Windows: no real difference.** WebView2 *is* Chromium, so all three run the same engine. A hello-world window costs about 70 MB on Electron and 71 MB on WebView2. On macOS and Linux the system webview is WebKit, which tends to need less memory; that is not measured here yet.

**Most of the memory is the app, not the runtime.** Above the ~70 MB engine floor, GitDesk itself uses 70–100 MB idle. Opening one TypeScript file in the code view adds another ~100 MB, Monaco's editor plus its TypeScript language worker. The changes and history views add ~40 MB together.

## Quick win, independent of the runtime (now on main)

Electron packaged every `dependency` from `package.json` next to the bundle, although Vite already bundles everything the renderer needs into `dist/`: 290 MB of unused `node_modules` (mermaid 116 MB, monaco-editor 70 MB, lucide 20 MB, …). Renderer libraries are now `devDependencies` and only `yaml` (used by the engine in the main process) remains a dependency: −47 MB download, −275 MB installed, and about 25 MB less memory.

## What each switch would cost

**Tauri**
- The engine runs in the webview, so the renderer has file and process access (scoped to the app's own origin, but no longer a separate process). Keeping Electron's security model means porting `core/` (~1,700 lines) to Rust.
- Linux renders with WebKitGTK, which is noticeably slower and less complete than Chromium. Monaco, Mermaid and the CSS need testing there.
- Not yet ported: jump list, window size memory, PlantUML server (blocked by the webview's content security policy).

**Deno Desktop**
- Labelled experimental. No folder dialog yet (the prototype calls PowerShell, `osascript` or `zenity`), no theme override, no single-instance or jump list support.
- Writes its WebView2 profile next to the executable, which fails in a read-only install location such as `Program Files`.
- Bindings are available to whatever page the webview shows; there is no navigation guard like Electron's.
- Ships its own 77 MB runtime, so the size win is smaller than Tauri's.

## Recommendation

1. ~~Take the packaging fix to `main`.~~ Done.
2. If memory is the concern, the biggest lever is in the app: load Monaco only for editing and release it afterwards, or replace it with CodeMirror 6 for most files.
3. If download size is the concern, Tauri is the candidate. Run the comparison workflow, try the macOS and Linux builds, and decide whether to port the engine to Rust before committing to it.
4. Revisit Deno Desktop once it is stable.

## Trying the prototypes

Every push to an `experiment/**` branch runs the *Runtime comparison* workflow. Each run's page has one artifact per platform with the Tauri installers (`.exe`/`.msi`, `.dmg`, `.deb`/`.rpm`/`.AppImage`) and the Deno build as a `.tar.gz`. The builds are unsigned: on macOS, open the app once with right-click → *Open*; on Linux, `chmod +x` the AppImage.

Tauri keeps its settings apart from the Electron app (`dev.gitdesk.tauri`), and installs as "GitDesk Tauri", so both can be installed side by side.

To build locally:

```bash
npm run package:tauri
npm run package:deno
```

Tauri needs a Rust toolchain (and `libwebkit2gtk-4.1-dev` on Linux). Deno comes from npm. Outputs land in `desktop/tauri/src-tauri/target/release/` and `release-deno/`.

| File | Purpose |
| --- | --- |
| `session.ts`, `methods.ts` | Electron's IPC handlers without Electron, shared by both shells |
| `renderer-api.ts` | `window.gitdesk` over a single transport, like `electron/preload.cjs` |
| `vite.config.ts` | Renderer build per shell (`--mode deno` or `--mode tauri`) |
| `deno/main.ts`, `deno/web.ts` | Deno shell: static server, window, one binding |
| `tauri/web.ts`, `tauri/globals.ts`, `tauri/node/` | Tauri renderer entry and the Node module shims |
| `tauri/src-tauri/` | Rust side: file system and process commands, plugins |
