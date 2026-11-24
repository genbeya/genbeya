---
id: GENBEYA-67
title: Update rockuml to 0.3.0
type: chore
status: todo
priority: medium
labels: [dependencies, diagrams]
milestone: 0.2.1
---

`@rockuml/core` and `@rockuml/angular` 0.3.0 were published on 2026-10-27; Genbeya 0.2.0 still ships 0.2.1. `^0.2.1` never picks up 0.3.0 by itself, since a caret range on 0.x stays within its minor version. Nothing critical for Genbeya changed, so it waited for 0.2.1.

`@rockuml/angular` 0.3.0 needs Angular `^22.2.0` (Genbeya has 22.2.2) and `@rockuml/core` `^0.3.0`.

- [ ] Both packages at `^0.3.0` in `package.json`, and the lockfile updated with `npm install`
- [ ] Check the uses: `src/client/app/app.config.ts`, `src/client/app/markdown/diagrams.ts`, `src/shells/vscode/webview/markdown.ts`, and `scripts/build-vscode.mjs`, which copies `rockuml.wasm` into the extension
- [ ] Tests: typecheck, client and backend tests, `npm run test:vscode`, and `npm run e2e:demo`, which draws the PlantUML diagrams
- [ ] What's new for 0.2 and the extension's changelog, if 0.3.0 changes something users see
