# Genbeya for VS Code

[Genbeya](https://genbeya.fyi) gives a Git repository a wiki and a task board, kept as plain Markdown files in the repository: pages in `docs/`, one file per task in `tasks/`, settings in `.genbeya.yml`. This extension shows them in VS Code.

- **Wiki**: the page tree. A page opens in a preview rendered as in the app: references to tasks and pages with their live titles and states, callouts, Mermaid and PlantUML diagrams, math. **Edit** opens it in VS Code's editor.
- **Tasks**: the tasks as a tree, one group per workflow state. Drag tasks onto another state to move them; the context menu changes their status, type, priority, assignee, epic and labels. A task opens in its preview, where its properties, fields and comments can be changed too.
- **Board**: the board icon in the Tasks view opens the board, with filters and a swimlane per epic. Drag cards between columns and lanes; a click shows the task in a popup.

It works on repositories on this computer and, through VS Code's remote support, in WSL, over SSH and in containers. Areas kept on a shared content branch open and save through Genbeya, which commits each save there.

This is an early preview. The desktop app at [genbeya.fyi](https://genbeya.fyi) has everything else, such as Genbeya's Git tools.

## License

Functional Source License 1.1, ALv2 Future License (`LICENSE.md`). Text Genbeya writes into your repositories is MIT-0 (`LICENSE-MIT-0.md`).
