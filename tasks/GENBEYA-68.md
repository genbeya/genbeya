---
id: GENBEYA-68
title: Build the kit, Genbeya's renderer and editor as one bundle for other hosts
type: feature
status: done
priority: high
labels: [kit, mobile, release]
milestone: 0.2.1
---

`npm run build:kit` builds Genbeya's Markdown renderer and its editor as one self-contained browser bundle, the **kit**, that any host can show in a web view and talk to through messages. Each release attaches it as `genbeya-kit-<version>.zip`, as it carries the web demo and the VS Code extension. The mobile app ([genbeya_mobile](https://github.com/h3ll5ur7er/genbeya_mobile)) is the first host; the VS Code webviews could become the second.

The spec is [Kit build](https://github.com/h3ll5ur7er/genbeya_mobile/blob/claude/genbeya-flutter-mobile-plan-2wse4v/docs/Upstream/Kit-build.md) in the mobile app's repository: the bundle's files and `manifest.json`, the two globals (`window.genbeyaKitHost`, `window.genbeyaKit`), every message both ways, and protocol versions. Until Genbeya has it, the mobile app builds the same bundle itself from a pinned commit; once Genbeya ships it, the app downloads the release's zip and checks it against its manifest.

The kit is a shell like the VS Code webviews: it may use the client's code, the client doesn't depend on it, and nothing changes in the file formats or the managers.

### Groundwork

- [x] One renderer for the VS Code webviews and the kit, from `src/shells/vscode/webview/markdown.ts`: `toggle` carries the hash of the version shown, `[BURNDOWN]` and `[BASELINE]` ask the host for the plan's history, and the calendar is passed
- [x] `isMac` and `MOD_KEY` (now in the hotkeys) and `iconElement` move into plain modules, so the editor modules need no Angular

### The kit

- [x] `src/shells/kit/`: `kit.ts` (entry), `bridge.ts` (the host interface), `protocol.ts` (the messages), `editor.ts` (CodeMirror with the client's editor modules)
- [x] `npm run build:kit` writes `dist/kit/` with the files the spec lists, `manifest.json` listing each with its SHA-256 and size, and `LICENSES.txt`; built with the esbuild settings of `vscodeWebviewBundle`
- [x] The content security policy of `src/shells/content-security-policy.ts` as a meta tag, without `frame-ancestors`; no network
- [x] The kit renders `preview` messages of all three kinds (page, task, Markdown) and edits text with `[[`, `@` and `//` completion, through the two globals only
- [x] `context` parts are versioned and applied separately, so a large file list goes once
- [x] Every message from the kit is one of the protocol's, checked by unit tests like `rpc.spec.ts`

### CI, releases, docs

- [x] `build.yml` builds the kit on Linux, uploads `Genbeya-kit` on every run with its compressed size in the step summary, and a release attaches `genbeya-kit-<version>.zip`
- [x] `npm run e2e:kit`: Playwright's Chromium with a test host renders a page with references, a Mermaid and a PlantUML diagram and math, answers a checkbox with `toggle`, completes `[[`, requests nothing outside its own files, and the policy refuses an inline script
- [x] The kit as a shell in [[Architecture]], the protocol in the wiki, and the command in [[Development]]

### Open questions from the spec

- Load the kit in the VS Code webviews too, leaving one renderer bundle in Genbeya?
- Keep the three font families in the kit (about a megabyte), or let a host pass its own?
- PlantUML is 10 MB of the 18 MB: a later download in the app?
- A size budget per chunk as a CI check?

### Claude — 2026-11-24 08:05+01:00

Built as the spec describes; [[Kit]] documents the bundle and the protocol (version 1).

- **One renderer:** `src/shells/webview/markdown-renderer.ts`, moved from the VS Code webviews, with the host behind a small interface. Both hosts now get `[BURNDOWN]` and `[BASELINE]` (VS Code answers `planHistory` through the managers), the calendar, and toggles that name the version shown; VS Code leaves a file that changed since alone. The Markdown of plans over time is a plain function (`plan-history-markdown.ts`) that the app's service calls too.
- **Plain modules:** `core/platform-keys.ts` and `ui/icon-element.ts`; the hotkeys and the icon component re-export them, so no other importer changed.
- **The bundle:** `kit.js` is 380 kB (120 kB compressed), everything 19 MB, the zip 8 MB. The editor, Mermaid, KaTeX and rockuml are chunks loaded on demand.
- **Checks both ways:** the kit checks every message it receives (`parseToKit`, answering `error`) and every one it sends (`checkFromKit`), so a slip is caught before it reaches a host.

The spec's open questions, as built:

- **VS Code webviews as a host:** they share the kit's renderer, not its bundle. Their bridge and the kit's protocol differ in small ways; merging the bundles can wait until that buys something.
- **Fonts:** kept in the kit, so it renders the same everywhere; a host can override `font-ui` and `font-mono` with `theme`.
- **PlantUML's size:** it stays in the kit and loads only when a diagram needs it; a host that wants a smaller download could leave `rockuml.wasm` out.
- **A size budget per chunk:** not yet; CI reports the sizes in the step summary.

Tests: `protocol.spec.ts` (21), `npm run e2e:kit` (7), and the client (731), backend, VS Code smoke, web demo (11) and Electron editor and wiki tests pass. The backend's reset tests need a newer Git than this container's 2.43, as on `develop`.
