# Development

Requires Node.js 24 and Git. Tauri also needs a Rust toolchain (and `libwebkit2gtk-4.1-dev` on Linux); Deno Desktop comes from npm.

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
| `npm run package` | Electron installer for the current OS |
| `npm run package:tauri` | Tauri installers, in `src/shells/tauri/src-tauri/target/release/bundle/` |
| `npm run package:deno` | Deno Desktop build, in `release-deno/` |

## Tests

Code is written test first. Specs sit next to the code they test.

- **Backend** (`npm run test:backend`, Vitest): engines with plain data; resource access and managers against disposable repositories in `.test-work/`, including a content branch synced through a bare remote, and a WSL repository when the `Ubuntu` distribution exists. `backend.spec.ts` drives the managers through the RPC envelope, as a shell does. Both platforms pass the same machine contract (`src/testing/machine-contract.ts`).
- **Client** (`npm run test:client`, Vitest through `ng test`): components with a fake platform (`src/client/app/testing/fake-platform.ts`), engines of the client such as fuzzy search and the commit graph, and the Markdown pipeline.
- **End to end** (`npm run e2e`, Playwright): the packaged Electron app with a fresh profile and a fresh repository per test, opened through the `--open` launch argument. Covers wiki, tasks, version control and the shell.

## Continuous integration

- `.github/workflows/build.yml` runs lint, unit and end-to-end tests and packages the Electron app on Windows, macOS and Linux for every push and pull request to `main`. Pull requests upload the installers as workflow artifacts; pushes to `main` also publish them as a GitHub release tagged `v<version>-build.<run>`.
- `.github/workflows/runtimes.yml` runs the same tests and packages all three shells on every push to an `experiment/**` branch, reports their sizes and uploads each build as its own artifact (see [[Runtimes]]).

## Conventions

- Calls only go down the layers; ESLint enforces it. Managers do not call each other; engines do no I/O.
- Every manager method validates its own input.
- Client state lives in signals. The repository is in `core/session.ts`, navigation in the router; views own everything else.
- Operations go through `session.run`, which reports errors and refreshes the snapshot afterwards. Apply a save's result before the refresh, so the editor is clean when the snapshot arrives.
- Styles use the tokens in `src/client/styles/tokens.css`.
- Line endings are LF (`.gitattributes`); `npm run format` before committing.
