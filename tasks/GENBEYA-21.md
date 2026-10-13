---
id: GENBEYA-21
title: VS Code extension
type: feature
status: review
priority: high
labels: [vscode]
---

Genbeya inside VS Code, as a fourth shell next to Electron, Tauri and Deno Desktop: native views for the wiki and the tasks, a rendered preview of pages and tasks, a board, and VS Code's editor to edit them. See [[VS Code]].

- [x] Shell in `src/shells/vscode/`: managers in the extension host on the Node platform, the first Git repository among the workspace folders, the snapshot polled like the client polls it
- [x] Wiki view: the page tree; New Page
- [x] Tasks view: one group per workflow state; drag tasks between states or **Move to…**; New Task
- [x] Pages and tasks open in a preview by default (rendered as in the app: references, callouts, diagrams, math, embeds, comments); **Edit** opens the file
- [x] Board webview: columns per state, drag cards between them, a click shows the task's preview in a popup
- [x] Content file system (`genbeya-content:`) for areas on the content branch, committing each save
- [x] Runs where the workspace is (WSL, SSH, containers); off in untrusted workspaces
- [x] `npm run build:vscode`, `package:vscode` (`.vsix`), F5 launch configuration
- [x] Smoke test inside VS Code (`npm run test:vscode`), unit tests of the task groups and board columns
- [x] CI tests the extension and uploads the `.vsix` as an artifact
- [x] Documentation: Architecture/VS-Code, Development

Follow-ups: [[GENBEYA-22]], [[GENBEYA-23]], [[GENBEYA-24]], [[GENBEYA-25]]. Not published anywhere yet.
