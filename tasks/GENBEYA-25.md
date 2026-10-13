---
id: GENBEYA-25
title: Publish the VS Code extension
type: chore
status: review
priority: medium
labels: [vscode, release]
---

Publish the extension once it is ready for users.

- [x] Publisher `genbeya` on the Visual Studio Marketplace (token as the repository secret `VSCE_PAT`)
- [x] Namespace `genbeya` on Open VSX, for VSCodium, Cursor and other forks (token as `OVSX_PAT`)
- [x] Release job publishes the `.vsix` to both and attaches it to the GitHub release
- [x] Store listing: preview badge, banner, keywords, changelog, 128 pixel icon
- [ ] Screenshots in the extension's README
- [x] genbeya.fyi: link the extension on the download page and in the docs
- [ ] Verified publisher: a DNS record for genbeya.fyi, once the Marketplace allows it
