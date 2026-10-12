# Sharing

Right-click a wiki page, task, file or commit to copy a link to it, or focus it and press the context-menu key or `Shift+F10`. The `…` menus of pages, tasks and files offer the same entries.

- **Copy Genbeya link** copies a link such as `genbeya://open?remote=https://github.com/team/project.git&task=GENBEYA-12`. It opens the same item in a coworker's Genbeya, in their own clone, which Genbeya finds by the repository's remote (`origin`, or the first remote), whether it was cloned over https or ssh. A repository without a remote, or whose remote is a local path, can't be shared this way.
- **Copy web link** copies the item's page on GitHub, GitLab, Bitbucket or Azure DevOps. Pages and tasks link their Markdown files: on the [Content branch](../Architecture/Content-branch.md) when they live there, otherwise on the branch your current branch tracks.

## Opening a link

Click a Genbeya link anywhere, or paste it into the command palette (`Ctrl+K`) and choose **Open link**. Genbeya switches to the clone with that remote, the open repository or one from the recent list, and shows the item on whatever branch is checked out. When it knows no such clone, it offers to clone the repository. An existing clone that Genbeya has never opened is not known yet: open it once.

> [!NOTE]
> The installed Electron and Tauri apps register for `genbeya://` links. Deno Desktop can't, so paste links into the palette there.
