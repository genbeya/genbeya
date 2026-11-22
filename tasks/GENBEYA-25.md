---
id: GENBEYA-25
title: Publish the VS Code extension
type: chore
status: review
priority: medium
labels: [vscode, release]
---

Publish the extension once it is ready for users.

- [x] Publisher `genbeya` on the Visual Studio Marketplace, publishing through a Trusted Publishing policy for `build.yml`
- [x] Namespace `genbeya` on Open VSX, for VSCodium, Cursor and other forks, verified; publishes through trusted publishing, without a token
- [x] Release job publishes the `.vsix` to Open VSX and attaches it to the GitHub release
- [x] Visual Studio Marketplace: accepted as "Genbeya for VS Code" once the keywords were gone ([[GENBEYA-66]]); the release step publishes there with `vsce publish --oidc`
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

### Claude — 2026-11-22 19:14+01:00

0.1.0 is on the Marketplace, uploaded by hand as "Genbeya for VS Code". The release job publishes there again, now through trusted publishing (`npx @vscode/vsce@4.1.0 publish --oidc`, the job already had `id-token: write` for Open VSX), so the `VSCE_PAT` secret is no longer used and can be deleted. The guide and the release notes point VS Code users to the Marketplace.
