Genbeya {{version}} comes in three variants of the same app. Pick one installer for your system; the variants can be installed side by side.

- **Electron** (recommended): ships its own Chromium, so it behaves the same everywhere and is the most tested, but it is the largest download. Installs as "Genbeya".
- **Tauri**: a small download that uses the system webview (WebView2 on Windows, WebKit on macOS and Linux). Installs as "Genbeya Tauri" next to the others, with its own settings.
- **Deno Desktop**: experimental. Ships the Deno runtime and uses the system webview. Installs as "Genbeya Deno".

| System               | Electron                                             | Tauri                                                            | Deno Desktop                                            |
| -------------------- | ---------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| Windows              | `Genbeya-{{version}}-electron-windows-x64-setup.exe` | `Genbeya-{{version}}-tauri-windows-x64-setup.exe` or `.msi`      | `Genbeya-{{version}}-deno-windows-x64.msi`              |
| macOS, Apple silicon | `Genbeya-{{version}}-electron-macos-arm64.dmg`       | `Genbeya-{{version}}-tauri-macos-arm64.dmg`                      | `Genbeya-{{version}}-deno-macos-arm64.dmg`              |
| macOS, Intel         | `Genbeya-{{version}}-electron-macos-x64.dmg`         |                                                                  |                                                         |
| Linux                | `Genbeya-{{version}}-electron-linux-x64.AppImage`    | `Genbeya-{{version}}-tauri-linux-x64.AppImage`, `.deb` or `.rpm` | `Genbeya-{{version}}-deno-linux-x64.AppImage` or `.deb` |

Every build has a higher version than the one before, so an installer upgrades the installed version of its variant in place instead of installing next to it.

New to Genbeya? [Getting started](https://github.com/h3ll5ur7er/gitdesk/blob/main/docs/Getting-started.md) explains which variant to pick and how to open your first repository; in the app, **Settings → Help** has the tour and what's new.

The builds are unsigned:

- **Windows**: if SmartScreen warns, choose _More info → Run anyway_.
- **macOS**: open the app the first time with right-click → _Open_, or run `xattr -dr com.apple.quarantine "/Applications/Genbeya.app"` (or `Genbeya Tauri.app`, `Genbeya Deno.app`).
- **Linux**: make the AppImage executable with `chmod +x Genbeya-*.AppImage` before running it.
