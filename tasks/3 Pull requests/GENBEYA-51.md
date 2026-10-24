---
id: GENBEYA-51
title: Pull requests as a content area
type: feature
status: backlog
priority: medium
labels: [pull-requests]
---

Pull request files are a fourth area next to the wiki, the tasks and the settings: a folder (`pulls/` unless the settings say otherwise) that lives in the checkout or on the content branch, as the project chooses (`pulls = branch | checkout` in `.genbeya-content`). Done when a project can choose, move the area either way, and the snapshot carries its pull requests. See [[Design/Pull-requests#where-the-files-live]].

- [ ] Settings: the folder; `.genbeya-content`: the area
- [ ] **Settings → Where content lives**: pull requests, moving like the other areas
- [ ] In the checkout: the file lives on the source branch
- [ ] Snapshot and search include pull requests
- [ ] Optional part ([[GENBEYA-39]], [[GENBEYA-40]])
- [ ] Demo counterpart, `npm run e2e:demo`
- [ ] Update [[Architecture/Content-branch]] and [[Guide/Settings]]
