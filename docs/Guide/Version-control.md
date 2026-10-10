# Version control

## Changes

The **Changes** view lists staged and unstaged files. Select a file to see its diff; switch between side-by-side and inline with the button in the corner.

- Stage or unstage files one by one or all at once.
- Discard reverts a file to its staged version; untracked files are deleted. GitDesk asks first.
- Write a message and press `Ctrl+Enter`. With nothing staged, the button commits all changes.
- **Amend last commit** loads the previous message for editing.

Fetch, pull (fast-forward only) and push sit above the file list, together with how far the branch is ahead of or behind its upstream.

## Stashes

**Stash changes** (the box icon next to **Changes**) sets your uncommitted changes aside and cleans the working tree. Give the stash a message if you like; choose whether untracked files go along and whether staged changes stay in place.

Stashes are listed below the changes, newest first, with the branch they were made on. Select one to see its files and their diffs, then:

- **Pop** applies it and removes it from the list.
- **Apply** applies it and keeps it.
- **Branch…** creates a branch at the commit the stash was made on, switches to it and pops the stash there — useful when the stash no longer applies cleanly.
- **Drop…** deletes it. GitDesk asks first.

When a stash conflicts with your changes, the stash stays in the list.

## Branches

The branch button at the bottom of the sidebar switches branches; remote branches are checked out as tracking branches. Git refuses a switch that would overwrite local changes — commit, stash or discard them first.

Right-click a commit in **History** for everything else:

- **Create branch here…** starts a branch at the commit; tick **Switch to the new branch** to check it out right away.
- For each branch pointing at the commit: **Switch to**, **Rename…**, **Set upstream of…** (the remote branch pull and push use) and **Delete…**. A branch with commits that are on neither its upstream nor the current branch is only deleted after a second confirmation, since its commits could be lost.
- For each remote branch: **Check out** (when there is no local branch of that name) and **Delete on the remote…**, which removes it for everyone.

## Tags

Tags show as yellow chips in **History**. Right-click a commit and choose **Create tag here…**; with a message the tag is annotated, without one it is lightweight. The menu also pushes a tag to the remote, deletes it here, or deletes it on the remote. Deleting asks first.

## History

**History** shows every branch with a commit graph. Select a commit to see its message and files; merges are compared with their first parent.

> [!NOTE]
> GitDesk runs its own Git commands without repository hooks. Run Git in the [[Terminal]] when a workflow depends on hooks.
