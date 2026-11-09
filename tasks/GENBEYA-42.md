---
id: GENBEYA-42
title: Open repositories on GitLab, Bitbucket, Gitea and Forgejo, also self-hosted
type: feature
status: review
priority: low
labels: [integrations, web]
---

Everything of [[GENBEYA-39]] above the reader is forge-neutral. A reader per forge behind one interface (list a branch, read files) opens `/gitlab/<owner>/<repo>`, `/bitbucket/…`, `/gitea/…`, and self-hosted instances with `?host=`. Design and findings in [[Architecture/Forges]].

- [x] A forge reader interface; GitHub's reader behind it
- [x] GitLab (the API's tree comes in pages; raw files through the API, `/-/raw/` refuses other origins)
- [x] Gitea and Forgejo (the API mirrors GitHub's; self-hosted instances must enable CORS)
- [x] Bitbucket Cloud
- [x] Self-hosted hosts: the policy allows exactly the named host, the notice and the token field show it prominently
- [x] Addresses in each forge's own spelling (`/gitlab/<group>/<subgroup>/<project>/-/tree/<branch>`, …), and `?forge=…&repo=…` on the start page
- [x] A content security policy per address: the server allows only that forge's hosts (`scripts/serve-forge.mjs`), and a test checks a page for one forge can't reach another
- [x] Kept repositories told apart by forge and host
- [x] Tried on gitlab.com, gitea.com and Bitbucket Cloud; Codeberg limited the development environment's requests while it was probed
- [ ] Not covered: GitHub Enterprise Server, Bitbucket Data Center, Bitbucket API tokens with Basic authentication
