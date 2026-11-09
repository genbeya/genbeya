---
id: GENBEYA-39
title: Open a GitHub repository's board and wiki on genbeya.fyi
type: feature
status: review
priority: medium
labels: [integrations, github, web]
---

The forge plugin for GitHub: anyone looking at a repository on GitHub opens its Genbeya board and wiki at `genbeya.fyi/github/<owner>/<repo>`, without cloning, with references resolved as in the app. Design and findings: [[Architecture/GitHub]].

This task is the proof of concept: read-only, public repositories without signing in, private ones with a token kept in the tab's memory. Signing in through a GitHub App, writing back and the website's route follow once the concept holds.

- [x] Probe GitHub from a web page: which endpoints allow cross-origin requests, what a repository costs to load
- [x] Design page in the wiki
- [x] Read a repository through GitHub's REST API into an in-memory repository (`src/access/github/`)
- [x] A `github` build of the web client that opens the repository the address names, after a notice about what it requests from GitHub
- [x] Fetching and pushing explain that changes stay in the tab
- [x] Unit tests for the reader, an end-to-end test against a simulated GitHub
- [x] Try it on this repository: 3 API requests and 85 files, about 3 seconds
- [x] Read only Genbeya's content and what it refers to: reading all 706 files of this repository took 13 seconds, and a second load ran into raw.githubusercontent.com's limit (429)
- [ ] Try it on a private repository with a token, from a real browser (the development environment's proxy can't show CORS preflights)

Later, as their own tasks once the concept holds:

- Sign in with a GitHub App (OAuth through a stateless relay on genbeya.fyi; GitHub's token endpoints refuse requests from web pages)
- Commit edits back to GitHub
- Task activity and history from GitHub's commits
- The `/github/…` route and its notice on genbeya.fyi
- A GitHub Action that publishes the wiki and the board to Pages, for public repositories
