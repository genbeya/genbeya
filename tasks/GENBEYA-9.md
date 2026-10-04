---
id: GENBEYA-9
title: Harden SSH hosts
status: in-progress
priority: high
labels: [remote]
---

The shell transport is tested against WSL. SSH uses the same code but needs testing against real servers.

- [x] One persistent shell per repository, binary-safe framing
- [x] Batch mode: no password prompts, clear errors
- [ ] Jump hosts and `ProxyCommand` from `~/.ssh/config`
- [ ] Login shells that are not POSIX (fish): start `sh` explicitly
- [ ] Reconnect after sleep or network loss without a restart
