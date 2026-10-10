# Managers

Four managers implement everything the client can do with a repository. Their contracts are in `src/contracts/manager-contracts.ts`; `src/managers/backend.ts` composes them for a shell.

| Manager | Use cases |
| --- | --- |
| `workspace` | Open, clone, restore and close repositories; snapshots; recent repositories; app preferences; browsing folders on WSL and SSH |
| `content` | Files, wiki pages, tasks, `.gitdesk.yml`, and where each of those areas lives (the [[Content branch]]) |
| `versionControl` | Diffs, staging, commits, branches, remotes, fetch/pull/push, history |
| `terminal` | Shells in the repository for the [[Terminal]]: open, input, size, output, close |

Every call names the workspace it was made for (or a terminal, which belongs to one), so a call racing a repository switch fails instead of touching the new repository. Every argument is validated again in the manager, so managers can sit directly behind IPC.

## Calls

The client sends `{ manager, method, args }` and receives `{ ok: true, value }` or `{ ok: false, message }` (`src/contracts/rpc.ts`). `MANAGER_METHODS` lists the methods a shell may dispatch; the compiler checks that it matches the contracts.

## Snapshots

The client asks for `snapshot(workspace, since)` every four seconds and whenever the window regains focus. A snapshot holds branch state, changes, the file tree, the wiki tree, all tasks and settings. `since` is the version the client already has; when nothing changed the manager answers `null` and nothing is sent.

One snapshot costs a handful of Git calls:

- `git status --porcelain=v2 --branch` for branch, upstream, ahead/behind and changes
- `git ls-files` for the tree, which also hides everything `.gitignore` excludes
- `for-each-ref` and `remote -v` for branches and remotes
- a single batched read for all task files

## Remote folders

`workspace.browse({ kind, distro | host, path })` lists the subfolders of a folder on WSL or SSH, for the folder browser of the open and clone dialogs. An empty path, `~` or `~/…` starts in the home folder. The listing has the folder's absolute path (links resolved), its parent (null at `/`) and up to 2000 subfolders, sorted by name ignoring case with hidden ones last; each says whether it is a Git repository (holds `.git`), and `truncated` says when there were more. Folders on this computer use the system folder dialog instead.

Connection failures name the machine: `Can't connect to <host>: <ssh's reason>`, or `WSL has no distribution named <distro>.` See [[Hosts]] for how one listing travels.

## Terminals

`terminal.open(workspace, cols, rows)` asks the repository's host how to start a shell in its root (`src/access/hosts/terminal-commands.ts`) and starts it on a pseudo-terminal of the machine port; WSL and SSH shells run through `wsl.exe` and `ssh` on that terminal. Terminals belong to their workspace: they end when it closes, and when the app quits.

Shells only answer requests, so output reaches the client by long polling. `read(terminal)` returns everything printed since the last read as soon as there is some, an empty string after 25 seconds without output, and the exit code once the shell ended and its output was read. The client reads in a loop, which streams over every shell's bridge. Unread output is capped at a million characters; older output is dropped. Input is sent in order, batched while a write is under way.

```mermaid
sequenceDiagram
  participant C as Client
  participant M as Terminal manager
  participant P as Pseudo-terminal
  C->>M: open(workspace, 100, 30)
  M->>P: pwsh -NoLogo in the repository
  M-->>C: terminal id
  C->>M: read(id)
  P-->>M: the prompt
  M-->>C: { data }
  C->>M: write(id, "exit⏎")
  C->>M: read(id)
  P-->>M: exit 0
  M-->>C: { exit: 0 }
```

## Writes

Saves carry the hash of the content they were based on. If the file changed on disk since, the save is rejected and the editor keeps the draft. Line endings and a byte order mark are kept as they were. All operations on one workspace run one at a time.

## Content areas

The wiki, tasks and settings each live in the checkout or on the [[Content branch]]. File calls name a scope: `repo` is the checkout; `content` is wherever the path's area lives: `.gitdesk.yml` belongs to the settings, the task folder to the tasks, and everything else, such as pages and their images, to the wiki. Page, task and settings calls use their own area, and edits are committed right away only when that area is on the content branch. `content.setStorage(workspace, area, mode)` moves one area.

Inside the backend, `workspace.locateContent(path)` names the location of a content path (its root, files, Git and branch), for reading a file's history wherever it lives.

## Paths

Repository paths from the client are validated in `src/utilities/repository-path.ts`: no absolute paths, no `..`, nothing inside `.git` (including Windows aliases such as `.git.` and `GIT~1`). Hosts refuse to follow symbolic links below the repository root. Git runs with `--literal-pathspecs`, so file names are never globs.
