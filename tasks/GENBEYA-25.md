---
id: GENBEYA-25
title: Publish the VS Code extension
type: chore
status: in-progress
priority: medium
labels: [vscode, release]
---

Publish the extension once it is ready for users.

- [x] Publisher `genbeya` on the Visual Studio Marketplace, publishing through a Trusted Publishing policy for `build.yml`
- [x] Namespace `genbeya` on Open VSX, for VSCodium, Cursor and other forks, verified; publishes through trusted publishing, without a token
- [x] Release job publishes the `.vsix` to Open VSX and attaches it to the GitHub release
- [x] Visual Studio Marketplace: accepted as "Genbeya for VS Code" once the keywords were gone ([[GENBEYA-66]]); the release step publishes there with `vsce publish --oidc`
- [x] Store listing: preview badge, banner, changelog, 128 pixel icon
- [ ] Keywords: the Marketplace refused the new extension with all nine ([[GENBEYA-66]]); 0.2.1 brings back four (wiki, kanban, markdown, git), the rest once the Marketplace takes those
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

### Claude — 2026-11-22 23:12+01:00

0.2.0 went out through the release job to both stores: `vsce publish --oidc` published `genbeya.genbeya` 0.2.0 on the Marketplace, the first time without a token. Still open: the keywords, screenshots in the README, and the verified publisher.

### Claude — 2026-11-24 08:14+01:00

Before adding keywords back, I searched the Marketplace for each of the nine as a tag (its gallery API, VS Code extensions only). Every one is in use, so none is refused on its own:

| Keyword | Extensions with it |
| --- | --- |
| git | 4,163 |
| markdown | 3,979 |
| documentation | 1,065 |
| todo | 497 |
| tasks | 405 |
| kanban | 179 |
| project management | 178 |
| wiki | 102 |
| board | 58, mostly colour themes |

So about half come back in 0.2.1, the most relevant and most established: `wiki`, `kanban`, `markdown` and `git`. Left for later: `tasks`, `todo` and `documentation` (generic), `board` (mostly themes) and `project management` (the only one with a space).

The release is the test: its Marketplace step publishes an update with them. If the Marketplace refuses it, that step fails after the GitHub release and Open VSX are done; take the keywords out again and publish the next patch. If it takes them, the next release can bring back the rest.
