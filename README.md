# Marketplace probes (GENBEYA-66)

Results so far, each probe being the accepted empty probe plus one piece of Genbeya's metadata:

- Accepted: the display name "Genbeya"; contributes; README; changelog; licences; icon; `description`; `preview`; `homepage` (genbeya.fyi).
- Refused: `keywords` (wiki, tasks, kanban, board, markdown, git, documentation, project management, todo).

`genbeya-probe-2-rest.vsix` combined the remaining fields: `pricing`, `author`, `bugs`, `galleryBanner` and `extensionKind`. It was accepted. Delete this branch once the extension is uploaded.

`Genbeya-0.1.0-vscode.vsix` is the real extension from fix/vscode-extension-without-terminals (e099cbd), without keywords.
