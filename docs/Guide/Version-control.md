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

When a stash conflicts with your changes, the stash stays in the list and the conflicted files appear under **Conflicts** (see below).

## Branches

The branch button at the bottom of the sidebar switches branches; remote branches are checked out as tracking branches. Git refuses a switch that would overwrite local changes — commit, stash or discard them first.

Right-click a commit in **History** for everything else:

- **Create branch here…** starts a branch at the commit; tick **Switch to the new branch** to check it out right away.
- For each branch pointing at the commit: **Switch to**, **Rename…**, **Set upstream of…** (the remote branch pull and push use) and **Delete…**. A branch with commits that are on neither its upstream nor the current branch is only deleted after a second confirmation, since its commits could be lost.
- For each remote branch: **Check out** (when there is no local branch of that name) and **Delete on the remote…**, which removes it for everyone.

## Tags

Tags show as yellow chips in **History**. Right-click a commit and choose **Create tag here…**; with a message the tag is annotated, without one it is lightweight. The menu also pushes a tag to the remote, deletes it here, or deletes it on the remote. Deleting asks first.

## Merging

To merge a branch into the current one, right-click a commit it points to in **History** and choose **Merge … into …**, or search the palette (`Ctrl+K`) for **Merge into …** and pick the branch. Remote branches and tags merge the same way.

The dialog shows the merge commit's message, which you can change. When the current branch has no commits of its own, Git just moves it forward and makes no merge commit; tick **Always create a merge commit** to get one anyway.

## Conflicts

When a merge, rebase, cherry-pick or revert conflicts, Git stops halfway. A banner above every view says what is going on — for example *Merging feature into main — 2 conflicts* — with:

- **Continue**, once every conflict is resolved: finishes the merge with its prepared message, or goes on with the next commit of a rebase.
- **Skip** (rebase, cherry-pick and revert): leaves out the commit Git stopped at.
- **Abort**: puts everything back as it was before the operation started. GitDesk asks first; resolutions made so far are lost.

Conflicted files are listed under **Conflicts** at the top of **Changes**. Select one to resolve it:

- The editor shows the file with Git's conflict markers. The bar above it steps through the conflicts; **Accept current** keeps your side (HEAD), **Accept incoming** the side being merged in, **Accept both** keeps both, yours first. Files written in Git's diff3 style also show the common ancestor, which accepting a side drops.
- Edit the result freely in the editor — the buttons always act on the conflicts still marked in the text.
- **Take current** and **Take incoming** in the header use one side for the whole file.
- **Mark as resolved** saves the result and stages it. With conflict markers left, GitDesk asks first.

Binary files offer only whole sides. A file one side deleted and the other changed offers to keep it or delete it.

> [!NOTE]
> During a rebase, *current* is the branch you rebase onto, with the commits already replayed, and *incoming* is the commit being replayed — that is how Git names the sides.

## History

**History** shows every branch with a commit graph. Select a commit to see its message and files; merges are compared with their first parent.

> [!NOTE]
> GitDesk runs its own Git commands without repository hooks. Run Git in the [[Terminal]] when a workflow depends on hooks.
