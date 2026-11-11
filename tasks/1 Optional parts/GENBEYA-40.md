---
id: GENBEYA-40
title: Let each user hide parts of the app
type: feature
status: in-progress
priority: medium
labels: [settings]
---

The user layer of [[Design/Optional-parts]]: each person hides parts they don't want to see, per repository with a default for all repositories, in their personal preferences. Done when a hidden part is gone from that person's sidebar, palette and search, shortcuts skip it, references into it still resolve, and nothing in the repository changes.

Prototype on `feature/optional-parts`: `hiddenParts` in the preferences, one list for every repository and lists for single ones; `src/client/app/core/parts.ts` decides. References into a hidden part still open it. Left: read-only previews, parts switching themselves on.

- [x] Decide: per repository by default, or global with per-repository overrides
- [x] Preferences: store the hidden parts, next to the other personal preferences
- [x] **Settings → App**: a switch per part (only parts the project uses, see [[GENBEYA-39]])
- [x] Sidebar and `Ctrl+K` palette leave hidden parts out; `Ctrl+1` … `Ctrl+6` keep their views and skip hidden ones
- [x] Search leaves hidden parts out
- [ ] References into a hidden part still show their title and open a read-only preview
- [ ] Defaults: existing users see everything; a part switches itself on when the project clearly uses it
- [x] Demo counterpart, `npm run e2e:demo`
- [x] Document in [[Guide/Settings]] and [[Guide]]
