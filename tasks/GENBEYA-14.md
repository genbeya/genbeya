---
id: GENBEYA-14
title: Rewrite on a host-agnostic engine
status: done
priority: high
labels: [architecture]
---

Replace the proof of concept with a maintainable structure.

- [x] `core/` engine without Electron, validated inputs, serialized operations
- [x] Host interface: local, WSL and SSH
- [x] Renderer split into views, components and app state
- [x] Design system with dark and light themes
- [x] Engine tests against real repositories, including WSL
