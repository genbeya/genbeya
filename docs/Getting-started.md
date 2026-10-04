# Getting started

## Install

GitDesk needs **Git** on the machine that holds the repository. To run from source you also need **Node.js 24** and npm.

```bash
npm install
npm run dev
```

`npm run dev` starts the renderer with hot reload and the Electron app. Restart it after changing `core/` or `electron/`.

## Open a repository

| From | How |
| --- | --- |
| This computer | **Open folder** (`Ctrl+O`). Any folder inside a Git working tree works. |
| WSL | **Open on WSL or SSH** → WSL, pick the distribution and enter a Linux path. Picking a `\\wsl$\…` folder in the folder dialog also opens it through WSL. |
| SSH | **Open on WSL or SSH** → SSH, enter `user@host` (or a `Host` from `~/.ssh/config`) and the repository path. |
| A remote URL | **Clone repository**, then choose where the clone goes — locally, on WSL or over SSH. |

On WSL and SSH, Git runs on the remote machine; GitDesk talks to it through one long-lived shell. See [[Hosts]].

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
```

Edit them in **Settings**; unknown keys and comments in the file are preserved.
