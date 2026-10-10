# Managers

Four managers implement everything the client can do with a repository. Their contracts are in `src/contracts/manager-contracts.ts`; `src/managers/backend.ts` composes them for a shell.

| Manager | Use cases |
| --- | --- |
| `workspace` | Open, clone, restore and close repositories; snapshots; recent repositories; app preferences; browsing folders on WSL and SSH |
| `content` | Files, wiki pages, tasks, `.gitdesk.yml`, and the [[Content branch]] |
| `versionControl` | Diffs, staging, commits, stashes, branches, tags, remotes, fetch/pull/push, history, merges and conflicts |
| `terminal` | Shells in the repository for the [[Terminal]]: open, input, size, output, close |

Every call names the workspace it was made for (or a terminal, which belongs to one), so a call racing a repository switch fails instead of touching the new repository. Every argument is validated again in the manager, so managers can sit directly behind IPC.

## Calls

The client sends `{ manager, method, args }` and receives `{ ok: true, value }` or `{ ok: false, message }` (`src/contracts/rpc.ts`). `MANAGER_METHODS` lists the methods a shell may dispatch; the compiler checks that it matches the contracts.

## Snapshots

The client asks for `snapshot(workspace, since)` every four seconds and whenever the window regains focus. A snapshot holds branch state, changes (conflicted ones say how they conflict), tags, stashes, the merge, rebase, cherry-pick or revert in progress, the file tree, the wiki tree, all tasks and settings. `since` is the version the client already has; when nothing changed the manager answers `null` and nothing is sent.

One snapshot costs a handful of Git calls:

- `git status --porcelain=v2 --branch` for branch, upstream, ahead/behind, changes and conflicts
- `git ls-files` for the tree, which also hides everything `.gitignore` excludes
- `for-each-ref` and `remote -v` for branches, tags and remotes
- `stash list` for the stashes
- a single batched read for all task files
- a single batched read of `MERGE_HEAD`, `rebase-merge/…` and their kind in the git directory for the operation in progress (and, during a rebase, a `for-each-ref` to name what it goes onto)

## Operations that stop

Merging (and applying a stash) can stop for conflicts. These calls resolve to `"done"`, or to `"stopped"` when Git left conflicts or an operation in progress; the snapshot then shows the operation and the conflicted files, and `continueOperation`, `skipOperation` and `abortOperation` go on with whatever is in progress — the manager reads which operation that is, the client does not say. `continueOperation` refuses while conflicts are left. A failure that leaves nothing to resolve (local changes in the way, say) is an error as usual.

`conflict(path)` returns a conflicted file's text with its markers (null for binary, missing or oversized files); `resolveConflict` takes one side (`git checkout --ours/--theirs`, or `git rm` when that side deleted the file), keeps the working-tree file, deletes the file, or writes new text — and stages the result. Conflict markers, including the diff3 style, are parsed in `src/utilities/conflict-markers.ts`, which the client uses for its hunk buttons.

Git never opens an editor for GitDesk: every call runs with `GIT_EDITOR=:`, which makes Git keep the message it prepared, as for `merge --continue`.

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

## Paths

Repository paths from the client are validated in `src/utilities/repository-path.ts`: no absolute paths, no `..`, nothing inside `.git` (including Windows aliases such as `.git.` and `GIT~1`). Hosts refuse to follow symbolic links below the repository root. Git runs with `--literal-pathspecs`, so file names are never globs.
