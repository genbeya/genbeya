# Development

Requires Node.js 24 and Git. Tauri also needs a Rust toolchain (and `libwebkit2gtk-4.1-dev` on Linux); Deno Desktop comes from npm. The terminal's node-pty ships prebuilt for Windows and macOS; on Linux `npm install` compiles it, which needs Python, `make` and a C++ compiler.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Client with hot reload plus the Electron app. Restart it after changing the backend or the shell |
| `npm run check` | Type-check backend, shells and client |
| `npm run lint` | ESLint, including the layer rules of the [[Architecture]] |
| `npm run format` | Prettier |
| `npm test` | Backend and client unit tests |
| `npm run e2e` | Build, then end-to-end tests against the Electron app |
| `npm run build` | Production client and Electron shell |
| `npm run package` | Electron installer for the current OS, in `release/` |
| `npm run package:tauri` | Tauri installers, in `src/shells/tauri/src-tauri/target/release/bundle/` |
| `npm run package:deno` | Deno Desktop installers (`.msi`, `.dmg`, or `.AppImage` and `.deb`), in `release-deno/` |

## Tests

Code is written test first. Specs sit next to the code they test.

- **Backend** (`npm run test:backend`, Vitest): engines with plain data; resource access and managers against disposable repositories in `.test-work/`, including a content branch synced through a bare remote, and a WSL repository when the `Ubuntu` distribution exists. `backend.spec.ts` drives the managers through the RPC envelope, as a shell does. Both platforms pass the same machine contract (`src/testing/machine-contract.ts`); on Node it includes pseudo-terminals with the user's real shell. Managers that start terminals get fake ones (`src/testing/terminals.ts`).
- **Client** (`npm run test:client`, Vitest through `ng test`): components with a fake platform (`src/client/app/testing/fake-platform.ts`), engines of the client such as fuzzy search and the commit graph, and the Markdown pipeline.
- **End to end** (`npm run e2e`, Playwright): the packaged Electron app with a fresh profile and a fresh repository per test, opened through the `--open` launch argument. Covers wiki, tasks, version control, sharing, the shell, the terminal and the onboarding, and browsing WSL folders when the `Ubuntu` distribution exists. A test can launch the app again on the same profile (`launch`), e.g. with a `gitdesk://` link. Unpackaged builds do not register for `gitdesk://` links, so development never takes them over from the installed app. Profiles start as a user who has seen the tour and this version's news, so neither gets in the way; `test.use({ preferences: null })` starts like a first start, and other values set what the profile's `state.json` holds.

## Continuous integration

`.github/workflows/build.yml` runs on every push and pull request to `main` and on pushes to `experiment/**` branches. On Windows, macOS and Linux it runs lint, unit and end-to-end tests (`.github/actions/verify`) and the Tauri shell's Rust tests, then packages Electron, Tauri and Deno Desktop.

- `scripts/version.mjs stamp <run>` sets the patch number of the version to the run number before anything is built, so every build has a higher version than the one before (`0.3.0` in `package.json` becomes `0.3.57`) and installers upgrade an installed older version instead of refusing or installing next to it. `package.json` holds the major and minor version: raise the minor version for a release with new features.
- Deno Desktop's MSIs take their version from a generated `dist/deno/deno.json`; `scripts/msi-major-upgrade.ps1` adds the upgrade rules they lack.
- `scripts/collect-installers.mjs` copies every installer into `out/installers/`, renamed to `GitDesk-<version>-<variant>-<os>-<arch>[-setup].<ext>` (for example `GitDesk-0.3.57-tauri-windows-x64-setup.exe`), so the variants never clash. Run it locally after packaging; `--dry-run` only prints the names.
- `scripts/report-sizes.mjs` lists their sizes in the job summary.
- Each run uploads one artifact per variant and platform, such as `GitDesk-tauri-macOS`.
- Pushes to `main` also publish all installers as one GitHub release tagged `v<version>`, with the text of `.github/release-notes.md` above the generated notes.

macOS builds Electron for Apple silicon and Intel; Tauri and Deno Desktop only for the runner's Apple silicon.

## What's new and the tour

The app's version comes from `package.json` at build time (`src/client/app/core/app-version.ts`); CI stamps each build's patch number there. When the version is newer than the one the user saw last, GitDesk shows the news of every release line in between, once. First-time users get the tour instead.

To announce a change, add an item to the entry of its release line in `src/client/app/features/onboarding/changelog.ts`, newest release first:

```ts
{
  version: "0.4",
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

Entries are keyed by `major.minor`, since every build bumps the patch: a new entry only shows once `package.json` (and `tauri.conf.json` and `Cargo.toml` for Tauri) carries that minor version. Keep items to a sentence or two of Markdown.

The tour's steps are in `src/client/app/features/onboarding/tour-steps.ts`. A step names its element by selector, usually a `data-tour` attribute on it, and optionally the route it is on; steps whose element is missing are skipped. The tour itself (`src/client/app/ui/tour/`) knows nothing about the app.

## Conventions

- Calls only go down the layers; ESLint enforces it. Managers do not call each other; engines do no I/O.
- Every manager method validates its own input.
- Client state lives in signals. The repository is in `core/session.ts`, navigation in the router; views own everything else.
- Operations go through `session.run`, which reports errors and refreshes the snapshot afterwards. Apply a save's result before the refresh, so the editor is clean when the snapshot arrives.
- Styles use the tokens in `src/client/styles/tokens.css`.
- Line endings are LF (`.gitattributes`); `npm run format` before committing.
