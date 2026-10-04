# GitDesk

An Electron proof of concept for repository-native project management. Wiki pages, tasks, configuration, and source code live in the Git working tree. GitDesk opens existing repositories; it does not migrate them to a proprietary database.

## Run locally

Install **Node.js 24 LTS**, npm, and Git. Git must be available on your PATH. Then:

```bash
npm install
npm run dev
```

For the production renderer:

```bash
npm run build
npm start
```

Choose **Explore a demo** to create a sample repository in a folder you select. The demo includes a nested wiki, seven tasks, source code, two branches, a merge commit, and an uncommitted change. Its Git author configuration is set only inside the generated demo repository.

`npm run dev` starts Vite and Electron together. Renderer changes reload automatically; restart the command after editing the repository engine or Electron main process.

## Included

- Open an existing local repository, clone a Git remote, or create a demo.
- Nested Markdown wiki with matching sibling pages and directories, generated directory listings, relative Markdown links, filtering, page creation, source editing, and rendering.
- Markdown task board with filtering, drag-to-change status, task creation, title, assignee, labels, priority, and Markdown descriptions.
- File tree and offline-bundled Monaco source editor; UTF-8 files up to 2 MiB.
- Working-tree and staged side-by-side diffs, per-file stage/unstage, and commits of staged changes.
- Local branch creation and switching; branch changes require a clean working tree.
- History across all refs, parent-aware commit graph, changed-file lists, and historical file diffs against a commit’s first parent.
- Generic remote configuration, fetch, fast-forward-only pull, and push with upstream setup.
- Versioned project settings in `.gitdesk.yml`.
- Stale-save detection for files, tasks, and settings, plus serialized repository operations.

## Repository conventions

Settings are optional; the default wiki root is `docs/`, the default home is `Home.md`, and tasks live in `tasks/`.

```yaml
name: My project
wikiRoot: docs
wikiHome: Home.md
taskRoot: tasks
statuses:
  - backlog
  - in-progress
  - review
  - done
```

Wiki and task roots are configurable relative paths. They must not overlap. Changing a root changes where the app reads; it does not move existing files.

For the wiki, `docs/Architecture.md` is the page associated with the sibling directory `docs/Architecture/`. `docs/Architecture/Backend.md` is similarly associated with `docs/Architecture/Backend/`. A Markdown file with no corresponding directory is a leaf page. A directory without a matching Markdown page displays its children. `wikiHome` is relative to `wikiRoot`.

Tasks have one file per task:

```markdown
---
id: a-stable-unique-id
title: Implement authentication
status: in-progress
priority: high
assignee: alice
labels: [backend, security]
---

## Description

Support signing in and out.

## Acceptance criteria

- [ ] Users can sign in.
- [ ] Users can sign out.
```

The app generates UUIDs for new tasks. Existing IDs, extra frontmatter fields, and YAML comments survive task-form updates. Task filenames need not match their IDs. IDs should be unique within the repository. Invalid task files are reported as warnings instead of silently rewritten. Tasks in removed workflow states appear in additional columns; move them into a configured state to update them.

## Git providers and credentials

Repository operations use the installed Git CLI through `execFile`, without a shell. GitHub, Bitbucket, GitLab, generic SSH/HTTPS servers, and local paths all work through ordinary Git remotes. Provider-specific pull-request APIs and OAuth flows are outside this POC.

Configure your SSH agent or Git credential manager before cloning or synchronizing. Commands run with terminal credential prompting disabled and time out if they cannot complete. No passwords or tokens are written to `.gitdesk.yml`. Remotes live in Git’s local configuration.

Saving changes writes to the working tree. It does not stage, commit, or push automatically. Push is a deliberate action from the Version control tab. Native Git hooks are disabled for app-issued engine operations; run Git in your terminal if your workflow requires hooks. Commit author identity uses your existing Git configuration.

## Architecture

- `electron/engine.ts`: reusable Node/TypeScript repository engine; no Electron dependency.
- `electron/main.ts`: native dialogs, repository selection, process lifecycle, and validated IPC.
- `electron/preload.cjs`: narrow context-isolated bridge. No raw IPC or Node APIs exposed to the renderer.
- `shared/types.ts`: typed transport contracts.
- `src/App.tsx`: wiki, task board, source control, settings, and onboarding.
- `src/editor.tsx`: bundled Monaco editor and workers; no CDN dependency.
- `src/graph.tsx`: SVG commit lanes derived from actual parent relationships.
- `sample/`: starter content copied only when creating a demo.

Production assets load from a restricted, standard `gitdesk://app` origin so bundled editor workers can use the same origin. The renderer runs with sandboxing and context isolation, without Node integration. Navigation, popups, and permission requests are blocked. Repository-relative paths are validated; `.git` and symlinks cannot be edited. Markdown raw HTML is not rendered, remote images are disabled, and external links are not opened by this POC.

The POC derives its wiki/task index in memory and refreshes repository metadata every eight seconds. It intentionally does not yet introduce SQLite. Open editor buffers are retained; reload a file to pick up an external edit. Stale saves are rejected with the draft retained. The check detects intervening writes but is not a cross-process filesystem transaction or lock against an external editor writing at the exact same time.

## Checks and installers

```bash
npm run check
npm test
npm run build
npm run package
```

Repository tests use disposable repositories and cover wiki mapping, task persistence and metadata preservation, stale writes, path validation, malformed metadata, settings, rename staging, unborn repositories, branches, history, and local-remote fetch/pull/push.

The UI interaction test uses jsdom and the real repository engine; Monaco is replaced by a text-control test double. It covers wiki creation, task creation and status changes (including drag/drop), source saves, staging and commits, history, and settings. Type checks, 12 engine/asset integration tests, the UI interaction test, and the production build were verified in the build environment. Electron/Chromium could not launch in that environment; native dialogs, packaged app launch, visual layout, and Monaco runtime behavior require a workstation smoke test.

`npm run package` invokes electron-builder for your host OS (macOS DMG, Windows NSIS, Linux AppImage). Build on the target operating system. Signing, notarization, auto-update, and release distribution are not configured. The delivered source archive is not a signed installer.

## POC boundaries

- Single-user local workspace; Git synchronization provides collaboration. No simultaneous multiplayer editing, notifications, permissions per page/task, or Jira-style workflow automation.
- Wiki/tasks follow the checked-out branch. Separate documentation or management branches are not implemented.
- Latest 200 commits; graph parents beyond that boundary are not loaded.
- File tree limited to 10,000 entries and depth 30. Common generated/dependency directories are omitted; arbitrary `.gitignore` patterns are not used to hide explorer entries.
- No file/page deletion, rename UI, attachment viewer, integrated terminal, LSP servers, remote branch checkout, stash/rebase UI, or dedicated merge-conflict editor. Edit conflict markers in the code editor and use Git in a terminal for advanced recovery.
- Board search filters metadata; wiki and code search filter tree names. Full-content search is a follow-up.
- SSH/HTTPS host authentication and provider-specific behavior still need testing on a developer workstation.
