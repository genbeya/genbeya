# Kit

The kit is Genbeya's Markdown renderer and editor as one self-contained browser bundle that any app can show in a web view and talk to through messages. `npm run build:kit` builds it into `dist/kit/`, and each release attaches it as `genbeya-kit-<version>.zip`, next to the web demo and the VS Code extension. Genbeya's mobile app is the first host; it pins a release and checks the files against the kit's manifest. The work is tracked in [[GENBEYA-68]].

The kit is a shell like the VS Code webviews: it uses the client's code, the client doesn't depend on it, and nothing in the file formats or the managers changes for it. It renders pages, tasks and other Markdown as the app does and edits text; the host reads and writes the repository, and draws the rest (task properties, the board) natively.

[TOC]

## What the bundle holds

```text
kit.html        the page a host loads; the content security policy as a meta tag
kit.js          the entry: bridge, renderer; the editor loads when first asked for
kit.css         the app's tokens and Markdown styles
chunks/*.js     Mermaid, KaTeX, rockuml's loader, CodeMirror's languages, the editor: loaded on demand
fonts/*.woff2   Inter, JetBrains Mono, STIX Two Math
rockuml.wasm    PlantUML's engine, loaded the first time a PlantUML diagram is drawn
manifest.json   name, Genbeya version, commit, protocol, and every file with its SHA-256 and size
LICENSES.txt    the licenses of everything bundled, from the packages' own files
```

A host loads `kit.js` (about 380 kB, 120 kB compressed) and `kit.css` first; everything else when a page needs it. The whole kit is about 19 MB, of which rockuml's WebAssembly is 10 MB and Mermaid's chunks most of the rest.

The host serves the files from a custom scheme or a local server, with their media types (`application/wasm` for `rockuml.wasm`): `file://` doesn't let modules and WebAssembly load. The policy is the client's `CONTENT_SECURITY_POLICY` (`src/shells/content-security-policy.ts`) without `frame-ancestors`, which a meta tag can't carry: no inline scripts, and no connection but to the kit's own files.

| File | What it does |
| --- | --- |
| `src/shells/kit/kit.ts` | The entry: keeps the context, applies the theme, shows previews, opens the editor, reports the height |
| `src/shells/kit/bridge.ts` | The two globals, requests and replies; checks every message both ways |
| `src/shells/kit/protocol.ts` | The messages, `KIT_PROTOCOL`, and the checks `parseToKit` and `checkFromKit` |
| `src/shells/kit/editor.ts` | CodeMirror as the app sets it up, with `[[`, `@` and `//` completion and the toolbar's commands |
| `src/shells/webview/markdown-renderer.ts` | The renderer the kit shares with the VS Code webviews: the client's pipeline, diagrams, math, embeds, images and plans, with the host behind a small interface |
| `scripts/build-kit.mjs` | The build: esbuild with the settings of `kitBundle` in `scripts/bundles.mjs`, then the page, `rockuml.wasm`, the licenses, the manifest and, with `--zip`, the release's zip |

## Talking to the host

The host defines one global before `kit.html` loads; the kit defines one once it has started:

```ts
// Set by the host, e.g. with a user script:
window.genbeyaKitHost = { post(message: string): void };
// Set by the kit:
window.genbeyaKit = { receive(message: string): void };
```

Messages are JSON strings, which every web view can carry: Flutter's JavaScript channels, Android's `WebMessagePort`, `WKScriptMessageHandler`, VS Code's `postMessage`. The kit's first message is `ready`. It checks every message it receives and answers one it can't take with `error`; it checks every message it sends too, so it never sends one that isn't the protocol's.

### Host → kit

| Message | Carries | Notes |
| --- | --- | --- |
| `context` | `parts`: any of `wiki`, `tasks`, `plan`, `files`, `people`, `settings` (wiki folder, workflow, calendar) and `author`, each as `{ version, value }` | Only parts whose version changed need to be sent: on a repository with 20,000 files, the file list goes once, not with every edit. What is shown follows the new context |
| `theme` | `mode` (`light` or `dark`) and `tokens`, the app's CSS variables without their `--` | Names are lowercase words with dashes; values can't end the declaration or contain markup |
| `preview` | `document`: a `page` (path, title, source, hash), a `task` (as the managers return it; the kit shows its description and comments), or `markdown` (area, path, source, hash: a pull request file, a comment) | Rendered against the current context |
| `edit` | Area, path, text, its hash, and whether it is read-only; the language follows from the path | Opens the editor in place of the preview |
| `editorCommand` | `bold`, `italic`, `heading`, `list`, `checkbox`, `link`, `insert` (with `text`), `undo`, `redo`, `find`, `save` | The host's toolbar drives the editor |
| `reply` | `id`, and `value` or `error` | The answer to a request |

### Kit → host

| Message | Carries | The host must |
| --- | --- | --- |
| `ready` | `protocol`, and the kit's Genbeya version as `genbeya` | Refuse a kit whose protocol it doesn't speak |
| `follow` | `link`: `external` (url), `missing` (a page's title), `person` (handle), or `file` (path and anchor); a task reference arrives as its task's file | Navigate; open web links only for `http`, `https` and `mailto` |
| `toggle` | Area, path, the `hash` of the version shown, and the `offset` of the checkbox's list item in the text the kit rendered (a page's source, a task's description) | Check that the file still has that hash and a checkbox at that offset, then write |
| `image`, `file`, `fileAt` | `id`, a path (and a revision for `fileAt`) | Check the path with Genbeya's path rules and answer read-only: a data URL for images, the text for files, within Genbeya's size limits |
| `planHistory` | `id`, and a `baseline` or null | Answer as `content.planHistory` does, as JSON, for `[BURNDOWN]` and `[BASELINE]` |
| `height` | The rendered height in CSS pixels | Size the web view inside its native screen |
| `draft` | Path, base hash, text | Keep it outside the repository |
| `save` | Path, base hash, text | Write it as `content.write` does, refused once the file changed; then send `edit` again with the new hash |
| `editorState` | Path, whether there are unsaved changes, the selection, whether a completion list is open | Show or hide toolbar buttons |
| `error` | What the kit refused | Log it |

Completion for `[[`, `@` and `//` runs inside the kit, from the context it already has: no round trip per keystroke.

Everything the kit sends is untrusted input to the host, since the page it rendered is repository content. The protocol keeps the kit's power to what is listed: read files through paths the host checks, tick a checkbox in a version it names, and save text the person typed.

### Versions

`KIT_PROTOCOL` is a whole number, now 1. Adding a message or an optional field keeps it; removing or changing one raises it. A host pins a Genbeya release and checks the kit's `protocol` on `ready`.

## Tests

- `src/shells/kit/protocol.spec.ts`: every message of the protocol passes the checks both ways, and malformed ones don't.
- `npm run e2e:kit` (`e2e/kit/`, `playwright.kit.config.ts`): the built kit, served from its own origin, with a test host in the page. It renders a page with references, math, a Mermaid and a PlantUML diagram, a task with comments and other Markdown; answers checkboxes with `toggle` naming the version shown; asks for images; completes `[[` and runs toolbar commands and `save` in the editor; refuses messages that aren't the protocol's and inline scripts; and requests nothing from another origin. Every message the kit posts is checked with `checkFromKit`.

CI builds and tests the kit on Linux, uploads `Genbeya-kit` on every run with its size in the step summary, and a release attaches the zip.

## Open questions

- **The VS Code webviews as a host.** They share the kit's renderer already. Loading the kit itself would leave one renderer bundle; their board and task view would stay their own. Not yet: the webviews' bridge and the kit's protocol differ in small ways, and nothing breaks while they stay apart.
- **Fonts.** The kit bundles its three font families, about a megabyte, so it renders the same everywhere. A host that wants its own can override `font-ui` and `font-mono` with `theme`.
- **Size.** PlantUML's engine is 10 MB of the 19; it loads only when a diagram needs it. A host that wants a smaller download could leave it out and show PlantUML as source; nothing does yet.
- **A size budget per chunk** as a CI check: the step summary reports the sizes for now.
