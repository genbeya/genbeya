# Development

Requires Node.js 24 and Git. Tauri also needs a Rust toolchain (and `libwebkit2gtk-4.1-dev` on Linux); Deno Desktop comes from npm. The terminal's node-pty ships prebuilt for Windows and macOS; on Linux `npm install` compiles it, which needs Python, `make` and a C++ compiler.

## Run from source

```bash
npm install
npm start
```

`npm start` runs the client with hot reload and the Electron app. Restart it after changing anything outside `src/client/`. Open this folder in Genbeya: its wiki is this documentation and its task board is the real backlog.

### The web demo

`npm run start:demo` serves the [Demo](Architecture/Demo.md) at http://127.0.0.1:5173/ with the managers running in the page; it rebuilds on every change. To see the static build as genbeya.fyi serves it:

```bash
npm run build:demo
node scripts/serve-demo.mjs 4200
```

Then open http://127.0.0.1:4200/try/. Reloading the page starts the demo over.

### The VS Code extension

Open this folder in VS Code and press F5 (**Run the VS Code extension**): it builds the [VS Code extension](Architecture/VS-Code.md) into `dist/vscode` and opens this repository in a second VS Code window with it. After a change, run `npm run build:vscode` and reload that window (**Developer: Reload Window**).

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Client with hot reload plus the Electron app. Restart it after changing the backend or the shell |
| `npm run start:demo` | The web demo with rebuilds on change, in your browser |
| `npm run check` | Type-check backend, shells and client |
| `npm run lint` | ESLint, including the layer rules of the [Architecture](Architecture.md) |
| `npm run format` | Prettier |
| `npm test` | Backend and client unit tests |
| `npm run e2e` | Build, then end-to-end tests against the Electron app |
| `npm run e2e:demo` | Build the web demo, then its end-to-end tests in Chromium |
| `npm run build` | Production client and Electron shell |
| `npm run build:demo` | The web demo as static files, in `dist/demo/browser` |
| `npm run icons` | App icons of all three shells and the favicon, rendered from the logo in `branding/` |
| `npm run package` | Electron installer for the current OS, in `release/` |
| `npm run package:tauri` | Tauri installers, in `src/shells/tauri/src-tauri/target/release/bundle/` |
| `npm run package:deno` | Deno Desktop installers (`.msi`, `.dmg`, or `.AppImage` and `.deb`), in `release-deno/` |
| `npm run build:vscode` | The VS Code extension, unpacked in `dist/vscode` |
| `npm run test:vscode` | Build the VS Code extension, then its smoke test inside VS Code |
| `npm run package:vscode` | The VS Code extension as `Genbeya-<version>-vscode.vsix`, in `release-vscode/` |

## Tests

Code is written test first. Specs sit next to the code they test.

- **Backend** (`npm run test:backend`, Vitest): engines with plain data; resource access and managers against disposable repositories in `.test-work/`, including a content branch synced through a bare remote with some areas on it and the others in the checkout, and a WSL repository when the `Ubuntu` distribution exists. `backend.spec.ts` drives the managers through the RPC envelope, as a shell does. Both platforms pass the same machine contract (`src/testing/machine-contract.ts`); on Node it includes pseudo-terminals with the user's real shell. Managers that start terminals get fake ones (`src/testing/terminals.ts`).
- **Client** (`npm run test:client`, Vitest through `ng test`): components with a fake platform (`src/client/app/testing/fake-platform.ts`), engines of the client such as fuzzy search and the commit graph, and the Markdown pipeline.
- **End to end** (`npm run e2e`, Playwright): the packaged Electron app with a fresh profile and a fresh repository per test, opened through the `--open` launch argument. Covers wiki, tasks, version control, sharing, the shell, the terminal and the onboarding, and browsing WSL folders when the `Ubuntu` distribution exists. A test can launch the app again on the same profile (`launch`), e.g. with a `genbeya://` link. Unpackaged builds do not register for `genbeya://` links, so development never takes them over from the installed app. Profiles start as a user who has seen the tour and this version's news, so neither gets in the way; `test.use({ preferences: null })` starts like a first start, and other values set what the profile's `state.json` holds.
- **VS Code extension** (`npm run test:vscode`): `src/shells/vscode/test/smoke.ts` runs inside VS Code's extension host on a sample repository in a temporary folder: the extension opens it, shows its pages and tasks, and saves through its content file system. VS Code is downloaded to `.vscode-test/`; set `VSCODE_EXECUTABLE` to an installed `Code.exe` (or `code` binary) to use that instead. The views' pure parts have unit tests next to them.
- **Web demo** (`npm run e2e:demo`, Playwright in Chromium, `playwright.demo.config.ts`): the built demo served under `/try/` by `scripts/serve-demo.mjs`, a fresh page per test; every test also fails when the page requests anything from another origin. Install the browser once with `npx playwright install chromium`. The demo's managers have unit tests of their own in `src/managers/demo/` and `src/access/memory/`.

## Continuous integration

`.github/workflows/build.yml` runs on every push and pull request to `main` and on pushes to `experiment/**` branches. On Windows, macOS and Linux it runs lint, unit and end-to-end tests (`.github/actions/verify`) and the Tauri shell's Rust tests, then packages Electron, Tauri and Deno Desktop. On Linux it also builds the web demo, tests it in Chromium and uploads it as `genbeya-web-demo.zip`. It also tests the VS Code extension and uploads its `.vsix` as `Genbeya-<version>-vscode.vsix`; a release publishes that file to the Visual Studio Marketplace and to Open VSX, with the repository secrets `VSCE_PAT` and `OVSX_PAT` (a store whose secret is missing is skipped). The stores show `src/shells/vscode/README.md` and `CHANGELOG.md`; add the extension's changes to the latter with each release that has some.

- The version is `package.json`'s, and the same in its lockfile, `tauri.conf.json`, `Cargo.toml` and `Cargo.lock`: `node scripts/version.mjs bump patch` (or `minor`, `major`) or `set 1.0.0` changes all of them, and CI fails when they disagree (`node scripts/version.mjs check`). Bump the patch for fixes, the minor version for new features. Installers replace an installed older version, so every release needs a higher version.
- Deno Desktop's MSIs take their version from a generated `dist/deno/deno.json`; `scripts/msi-major-upgrade.ps1` adds the upgrade rules they lack, and refuses to install over a newer version. Installing an MSI of the same version again repairs it instead of upgrading.
- `scripts/collect-installers.mjs` copies every installer into `out/installers/`, renamed to `Genbeya-<version>-<variant>-<os>-<arch>[-setup].<ext>` (for example `Genbeya-0.1.0-tauri-windows-x64-setup.exe`), so the variants never clash. Run it locally after packaging; `--dry-run` only prints the names.
- `scripts/report-sizes.mjs` lists their sizes in the job summary.
- Each run uploads one artifact per variant and platform, such as `Genbeya-tauri-macOS`.
- A push to `main` whose version has no release yet publishes all installers, the VS Code extension and `genbeya-web-demo.zip` as one GitHub release tagged `v<version>`, with the text of `.github/release-notes.md` above the generated notes; pushes whose version is released already are built and tested only. To release: bump the version, commit, push. A release is marked latest only when no published `v*` release is newer.

macOS builds Electron for Apple silicon and Intel; Tauri and Deno Desktop only for the runner's Apple silicon.

## What's new and the tour

The app's version comes from `package.json` at build time (`src/client/app/core/app-version.ts`). When the version is newer than the one the user saw last, Genbeya shows the news of every release line in between, once. First-time users get the tour instead.

To announce a change, add an item to the entry of its release line in `src/client/app/features/onboarding/changelog.ts`, newest release first:

```ts
{
  version: "0.1",
  items: [
    {
      title: "Stash",
      body: "Set changes aside and bring them back later, from **Changes**.",
      // Optional: "Show me" in the dialog points at the element, after going to the route.
      target: '[data-tour="commit-box"]',
      route: "/changes",
    },
  ],
},
```

Entries are keyed by `major.minor`, the release line: a new entry only shows once `package.json` (and `tauri.conf.json` and `Cargo.toml` for Tauri) carries that minor version, and only to users updating from an older one. The changelog starts empty, in release line `0.0`; while it has no entry, nobody sees What's new, and **Show what's new** says there is nothing yet. Keep items to a sentence or two of Markdown.

The tour's steps are in `src/client/app/features/onboarding/tour-steps.ts`. A step names its element by selector, usually a `data-tour` attribute on it, and optionally the route it is on; steps whose element is missing are skipped. The tour itself (`src/client/app/ui/tour/`) knows nothing about the app.

## Conventions

- Calls only go down the layers; ESLint enforces it. Managers do not call each other; engines do no I/O.
- Every manager method validates its own input.
- Client state lives in signals. The repository is in `core/session.ts`, navigation in the router; views own everything else.
- Operations go through `session.run`, which reports errors and refreshes the snapshot afterwards. Apply a save's result before the refresh, so the editor is clean when the snapshot arrives.
- Styles use the tokens in `src/client/styles/tokens.css`.
- Line endings are LF (`.gitattributes`); `npm run format` before committing.

## Documentation

`docs/` is Genbeya's own wiki, and **Open the documentation** (in **Settings → Help**, the command palette and on the start screen) opens it on GitHub, so it has to make sense to people who never cloned the repository. Write it as the rest of the wiki: short, concrete, second person, present tense, with the labels the app shows in bold.

- Prefer live examples: `[[GENBEYA-12]]` next to its source shows readers what a reference does. Point them at tasks, pages and files that exist, so nothing renders as missing by accident.
- Screenshots live in `docs/images/`: the Electron app at its end-to-end window size (1000 × 680), light theme, the sample project as subject, reduced to 256 colours so each stays well under 150 KB. Link them relatively (`../images/search.png`).
- Announce user-facing changes in What's new as well (see above).

## License

Genbeya is licensed under the [Functional Source License](../LICENSE.md) (FSL-1.1-ALv2): anyone may use, change and share it, but not offer it, or something substantially similar built from it, as a competing commercial product or service; each version becomes Apache 2.0 two years after its release. The `license` fields of `package.json` and `Cargo.toml` say so too.

What Genbeya writes into users' repositories — the agent files, the sample project, new settings files and task templates — is under the [MIT No Attribution License (MIT-0)](../LICENSE-MIT-0.md), and so is that text in the source files it comes from. Those files start with a comment saying so, and LICENSE-MIT-0.md lists them. When you add a file that writes text into users' repositories, or move such text to another file, give it the same comment and update the list.

