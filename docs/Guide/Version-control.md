# Version control

## Changes

The **Changes** view lists staged and unstaged files. Select a file to see its diff; switch between side-by-side and inline with the button in the corner.

- Stage or unstage files one by one or all at once.
- Discard reverts a file to its staged version; untracked files are deleted. GitDesk asks first.
- Write a message and press `Ctrl+Enter`. With nothing staged, the button commits all changes.
- **Amend last commit** loads the previous message for editing.

Fetch, pull (fast-forward only) and push sit above the file list, together with how far the branch is ahead of or behind its upstream.

## Branches

The branch button at the bottom of the sidebar switches branches; remote branches are checked out as tracking branches. Git refuses a switch that would overwrite local changes — commit or discard them first.

## History

**History** shows every branch with a commit graph. Select a commit to see its message and files; merges are compared with their first parent.

> [!NOTE]
> GitDesk runs its own Git commands without repository hooks. Run Git in the [[Terminal]] when a workflow depends on hooks.
