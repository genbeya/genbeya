# Engine

`core/workspace.ts` is the single entry point for everything the renderer can do with a repository. Every method validates its arguments, so the class can sit directly behind IPC.

## Snapshots

The renderer polls `snapshot(version)` every few seconds and whenever the window regains focus. A snapshot holds branch state, changes, the file tree, the wiki tree, all tasks and settings. Its `version` is a hash of the content; when nothing changed the engine answers `null` and nothing is sent.

One snapshot costs a handful of Git calls:

- `git status --porcelain=v2 --branch` for branch, upstream, ahead/behind and changes
- `git ls-files` for the tree, which also hides everything `.gitignore` excludes
- `for-each-ref` and `remote -v` for branches and remotes
- a single batched read for all task files

## Writes

Saves carry the hash of the content they were based on. If the file changed on disk since, the save is rejected and the editor keeps the draft. All operations on one workspace run one at a time.

## Paths

Repository paths from the renderer are validated in `core/paths.ts`: no absolute paths, no `..`, nothing inside `.git` (including Windows aliases such as `.git.` and `GIT~1`). Hosts refuse to follow symbolic links below the repository root. Git runs with `--literal-pathspecs`, so file names are never globs.
