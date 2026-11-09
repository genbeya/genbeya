---
id: GENBEYA-42
title: Open repositories on GitLab, Bitbucket, Gitea and Forgejo, also self-hosted
type: feature
status: backlog
priority: low
labels: [integrations, web]
---

Everything of [[GENBEYA-39]] above the reader is forge-neutral. A reader per forge behind one interface (list a branch, read files) opens `/gitlab/<owner>/<repo>`, `/bitbucket/…`, `/gitea/…`, and self-hosted instances with `?host=`. Findings so far in [[Architecture/GitHub#other-forges]].

- [ ] A forge reader interface; GitHub's reader behind it
- [ ] GitLab (the API's tree comes in pages; raw files through the API, `/-/raw/` refuses other origins)
- [ ] Gitea and Forgejo (the API mirrors GitHub's; self-hosted instances must enable CORS)
- [ ] Bitbucket Cloud
- [ ] Self-hosted hosts: the policy allows exactly the named host, the notice and the token field show it prominently
