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
- [x] Namespace `genbeya` on Open VSX, for VSCodium, Cursor and other forks, verified; publishes through trusted publishing, without a token
- [x] Release job publishes the `.vsix` to Open VSX and attaches it to the GitHub release
- [ ] Visual Studio Marketplace: refused for an unnamed policy reason; ask support again after the cooldown (from 2026-10-22), then turn its release step back on
- [x] Store listing: preview badge, banner, changelog, 128 pixel icon
- [ ] Keywords: the Marketplace refuses a new extension with them ([[GENBEYA-66]]); add them back one at a time in updates once it is listed
- [ ] Screenshots in the extension's README
- [x] genbeya.fyi: link the extension on the download page and in the docs
- [ ] Verified publisher: a DNS record for genbeya.fyi, once the Marketplace allows it

### Claude — 2026-10-15 17:24+02:00

Open VSX accepted the namespace and registered `build.yml` as its trusted publisher, so the release job now publishes there with a short-lived token from GitHub's OIDC (`ovsx publish --trusted-publishing`, job permission `id-token: write`); the `OVSX_PAT` secret is no longer used and can be deleted.

Marketplace support answered that the content doesn't align with the Marketplace policy, without naming what, and set a mandatory one-week cooldown before they review it again. Until then the Marketplace step stays in the workflow behind `if: false`, and the README, the guide and the release notes point VS Code users to the `.vsix`.

### Claude — 2026-11-21 14:58+01:00

The refusal was the manifest's `keywords`, found with probe uploads ([[GENBEYA-66]]). The extension goes without them for its first upload.
