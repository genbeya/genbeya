# Architecture

GitDesk is an Electron app with three layers. The engine knows nothing about Electron, and the renderer knows nothing about the file system.

```mermaid
flowchart TB
  subgraph Renderer["Renderer (React, sandboxed)"]
    views[Views: wiki, tasks, code, changes, history, settings]
  end
  subgraph Main["Electron main process"]
    ipc[Validated IPC] --> state[Recent repositories, preferences]
  end
  subgraph Core["Engine (core/)"]
    workspace[Workspace] --> git[Git runner]
    workspace --> host[Host]
  end
  views -- "preload bridge" --> ipc
  ipc --> workspace
  host --> local[Local disk]
  host --> wsl[WSL shell]
  host --> ssh[SSH shell]
```

| Folder | Responsibility |
| --- | --- |
| `core/` | Repository engine: files, wiki tree, tasks, Git operations, hosts. Plain Node. |
| `electron/` | Window, protocol, IPC, preferences, PlantUML rendering. |
| `shared/` | Types shared by all layers. |
| `src/` | The React renderer. |
| `tests/` | Engine tests against real repositories, UI tests in jsdom. |

[SUBPAGES]
