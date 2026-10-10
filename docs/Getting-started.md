# Getting started

## Install

GitDesk needs **Git** on the machine that holds the repository. To run from source you also need **Node.js 24** and npm.

```bash
npm install
npm start
```

`npm start` runs the client with hot reload and the Electron app. Restart it after changing anything outside `src/client/`.

## First steps

On the first start, the start screen introduces GitDesk. **Try GitDesk with a sample project** asks for a folder, creates the repository `gitdesk-sample` in it and opens it: a small project, *Pocket Weather*, whose wiki shows references, embeds, subpages and diagrams, with tasks in every state and an epic, a few commits and one change left to commit. Delete the folder when you are done.

The first time a repository opens, the sidebar offers a tour: **Show me around** walks through the views, the wiki editor, the board, version control, the terminal, the command palette, settings and sharing, pointing at each. Try things while it runs; `Esc` or **Skip tour** ends it. Run **Start the tour** from the command palette (`Ctrl+K`) or **Settings → Help** to see it again.

After an update, **What's new** lists the news since the version you used last. **Settings → Help** shows the version and opens these notes and this documentation.

## Open a repository

| From | How |
| --- | --- |
| This computer | **Open folder** (`Ctrl+O`). Any folder inside a Git working tree works. |
| WSL | **Open on WSL or SSH** → WSL, pick the distribution and enter a Linux path or **Browse…** for it. Picking a `\\wsl$\…` folder in the folder dialog also opens it through WSL. |
| SSH | **Open on WSL or SSH** → SSH, enter `user@host` (or a `Host` from `~/.ssh/config`) and the repository path, or **Browse…** for it. |
| A remote URL | **Clone repository**, then choose where the clone goes — locally, on WSL or over SSH. |

On WSL and SSH, Git runs on the remote machine; GitDesk talks to it through one long-lived shell. See [[Hosts]].

**Browse…** shows the folders on the remote machine, starting at the path you typed or at your home folder. Double-click a folder (or select it and press `Enter`) to go into it, `Backspace` goes up, and typing the start of a name selects it. Git repositories are marked; when opening, select one and choose **Open** to open it right away. You can also type a path into the field at the top (`~` is your home folder) and press `Enter`. Hidden folders appear with **Show hidden folders**.

> [!NOTE]
> SSH connections run in batch mode: GitDesk never asks for passwords. Use an SSH agent or key, and connect once in a terminal so the host key is trusted.

Recently opened repositories appear on the start screen and in the repository menu at the top of the sidebar. GitDesk reopens the last one on start; turn that off in **Settings → App**.

## Configure the project

`.gitdesk.yml` at the repository root (or on the [[Content branch]]) holds shared settings. All keys are optional:

```yaml
name: GitDesk
wikiRoot: docs       # folder with wiki pages
wikiHome: Home.md    # first page, relative to wikiRoot
taskRoot: tasks      # folder with task files
taskPrefix: GENBEYA       # new tasks are GENBEYA-1, GENBEYA-2, …
statuses:            # board columns; the last one means done
  - backlog
  - todo
  - in-progress
  - review
  - done
hiddenColumns:       # states the board leaves out
  - backlog
```

Edit them in **Settings**; unknown keys and comments in the file are preserved.
