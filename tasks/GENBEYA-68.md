---
id: GENBEYA-68
title: Serve Genbeya on GitHub from its own origin, with a static badge
type: feature
status: todo
priority: medium
labels: [integrations, github, web, privacy]
---

Host the build of [[GENBEYA-66]] on the website, on an origin of its own (such as `open.genbeya.fyi`), with `genbeya.fyi/github/…` redirecting there. Browser storage and the content security policy belong to an origin: on its own, what the viewer keeps ([[GENBEYA-67]]) can't be read by the rest of the site, and genbeya.fyi's promise (no request to another origin, nothing stored) stays literally true. See [[Architecture/Forges#hosting]].

- [ ] Worker route: the build below `/_app/`, its page for every `/github/…` address, the policy as a header
- [ ] The build in each release, installed by the website like the demo
- [ ] The static "Open in Genbeya" badge (`branding/open-in-genbeya.svg`, made in [[GENBEYA-67]]) on genbeya.fyi, and the README snippet in the docs: never a per-repository image, which would work as a tracking pixel
- [ ] The website's privacy notice: what the viewer requests and keeps, and the hosting provider's request logs
