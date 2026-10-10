GitDesk {{version}} comes in three variants of the same app. Pick one installer for your system; the variants can be installed side by side.

- **Electron** (recommended): ships its own Chromium, so it behaves the same everywhere and is the most tested, but it is the largest download. Installs as "GitDesk".
- **Tauri**: a small download that uses the system webview (WebView2 on Windows, WebKit on macOS and Linux). Installs as "GitDesk Tauri" next to the others, with its own settings.
- **Deno Desktop**: experimental. Ships the Deno runtime and uses the system webview. Installs as "GitDesk Deno".

| System               | Electron                                             | Tauri                                                            | Deno Desktop                                            |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| Windows              | `GitDesk-{{version}}-electron-windows-x64-setup.exe` | `GitDesk-{{version}}-tauri-windows-x64-setup.exe` or `.msi`      | `GitDesk-{{version}}-deno-windows-x64.msi`              |
| macOS, Apple silicon | `GitDesk-{{version}}-electron-macos-arm64.dmg`       | `GitDesk-{{version}}-tauri-macos-arm64.dmg`                      | `GitDesk-{{version}}-deno-macos-arm64.dmg`              |
| macOS, Intel         | `GitDesk-{{version}}-electron-macos-x64.dmg`         |                                                                  |                                                         |
| Linux                | `GitDesk-{{version}}-electron-linux-x64.AppImage`    | `GitDesk-{{version}}-tauri-linux-x64.AppImage`, `.deb` or `.rpm` | `GitDesk-{{version}}-deno-linux-x64.AppImage` or `.deb` |

The builds are unsigned:

- **Windows**: if SmartScreen warns, choose _More info → Run anyway_.
- **macOS**: open the app the first time with right-click → _Open_, or run `xattr -dr com.apple.quarantine "/Applications/GitDesk.app"` (or `GitDesk Tauri.app`, `GitDesk Deno.app`).
- **Linux**: make the AppImage executable with `chmod +x GitDesk-*.AppImage` before running it.
