# GitDesk

GitDesk is a desktop workspace for a Git repository: a wiki, a task board, a code editor and version control in one window. Everything it shows is a plain file in the repository, so it works with any Git host and any other tool.

> [!TIP]
> You are reading GitDesk's own wiki, opened in GitDesk. The task board holds the real backlog.

[TOC]

## What lives where

| Area | Stored as | Read more |
| --- | --- | --- |
| Wiki | Markdown files in `docs/` | [[Wiki]] |
| Tasks | One Markdown file per task in `tasks/` | [[Tasks]] |
| Settings | `.gitdesk.yml` | [[Getting started]] |
| Code and history | The repository itself | [[Code]], [[Version control]] |

By default wiki pages, tasks and settings change with the branch you have checked out. A team working on many branches can keep any of them on a shared [[Content branch]] instead, for example just the tasks, so everyone sees the same board while the documentation stays with the code.

## Start here

- [[Getting started]] — install, open a repository locally, on WSL or over SSH
- [[Guide]] — how to use the wiki, the board and version control
- [[Architecture]] — how the app is put together
- [[Development]] — build, test and package

## Pages in this wiki

[SUBPAGES]
