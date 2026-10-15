---
id: GENBEYA-33
title: "Spike: open real repositories in the web demo with wasm-git and OPFS"
type: feature
status: review
priority: low
labels: [demo, experiment]
---

Can the web demo open a visitor's own repository? Clone it into the browser with [wasm-git](https://github.com/petersalomonsen/wasm-git) (libgit2's `lg2` compiled to WebAssembly), keep it in the origin private file system (OPFS), and import it into the demo's in-memory repository (`src/access/memory/`), so the demo managers open it as they open the sample.

wasm-git is libgit2's example command line, not Git, so it can't replace the demo's model ([[Architecture/Demo]] says why the demo doesn't run Git's command line). It is only the transport and the storage here.

Work happens on the branch `experiment/wasm-git-opfs`, not merged into `develop` unless decided. Done means the findings in [[Architecture/Demo-real-repositories]], with a go/no-go recommendation.

- [x] Load wasm-git in a Web Worker in the demo build only, through the OPFS auto-loader; record the variant Chromium and Firefox get
- [x] Clone a public repository over HTTPS into OPFS: from the CORS-enabled playground, and through a minimal CORS relay run locally (sketched as a Cloudflare Worker, public repositories only, no tokens, not shipped in the app)
- [x] Import the clone into `MemoryRepository`: the checked-out tree, refs and history
- [x] Open it through the demo managers, behind an opt-in entry on the start screen; read-only is enough
- [x] Measure clone and import time and memory for a small and a mid-sized repository (genbeya/genbeya), and reopen from OPFS after a reload
- [x] Stretch: write a commit made in the app back through libgit2 and push it
- [x] Wiki page with findings, measurements, browser support, the CORS options and their trust implications, what it changes about the demo's promise, and the recommendation
- [x] Existing demo tests still pass (`npm run test:client`, `npm run e2e:demo`)
- [ ] Measure Firefox: Windows refused to start Playwright's Firefox on the spike's machine

## Comments

### Claude — 2026-10-15 17:50+02:00

**Spike done; go as an opt-in experiment, no-go as the demo's default.** Details in [[Architecture/Demo-real-repositories]].

- With `?real-repositories`, **Demo** → **Open a repository from a URL (experimental)** (also on the start screen) clones into OPFS in a worker and opens the clone through the demo managers. Without it the demo is unchanged; its backend chunk is still 233 kB.
- Chromium gets wasm-git's JSPI build, or the threaded one when the page is cross-origin isolated; both cloned, reopened from OPFS with the network cut off, and pushed. Firefox should get JSPI from version 153, but it wasn't measured.
- genbeya/genbeya (373 commits, 673 files): clone 3.2–3.4 s through the local relay (native git: 2.0 s), import 1.6–2.3 s, about 60 MB of page heap, 8 MB in OPFS. The playground's 37-commit repository: 7.3 s to clone (its server is as slow for native git), 0.06 s to import.
- GitHub and the other forges send no CORS headers, so they need a relay (`scripts/cors-relay.mjs`, fetch-only, allowlisted hosts and pages, no credentials). Running it on genbeya.fyi is the real decision: it sees which repositories visitors open and needs limits.
- Stretch: a commit made in the app goes back through `lg2 add`, `lg2 commit` and `lg2 push` to a local `git http-backend` with CORS (the playground's push needs a NEAR sign-in); lg2 can't record deletions or merges, so those are refused.
- With the experiment on, the demo's "nothing is stored or sent" stops being true: clones are sent for and kept in the browser until deleted.
