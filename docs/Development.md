# Development

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Renderer with hot reload plus the Electron app |
| `npm run dev:browser` | Renderer in a browser against this repository, through a local HTTP bridge (design work, screenshots) |
| `npm run check` | Type-check renderer, engine and main process |
| `npm test` | Engine tests (real repositories, plus WSL when available) and UI tests |
| `npm run build` | Production renderer and main process |
| `npm run package` | Installer for the current OS via electron-builder |

## Tests

- `tests/core.test.ts` runs the engine against disposable repositories in `.test-work/`, including a content branch synced through a bare remote, and a WSL repository when the `Ubuntu` distribution exists.
- `tests/ui.test.tsx` renders the app in jsdom against the real engine. Monaco is replaced by a textarea.

## Continuous integration

`.github/workflows/build.yml` runs the tests and packages the app on Windows, macOS and Linux for every push and pull request to `main`. Pull requests upload the installers as workflow artifacts; pushes to `main` also publish them as a GitHub release tagged `v<version>-build.<run>`.

## Conventions

- The engine (`core/`) must not import Electron; it is tested without it.
- Every engine method that the renderer can reach validates its own input.
- Views own their state; shared state lives in `src/app/workspace.tsx` (repository) and `src/app/router.tsx` (navigation).
- Styles use the tokens in `src/styles/tokens.css`; each component imports its own CSS file.
