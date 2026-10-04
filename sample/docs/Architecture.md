# Architecture

The workspace has a React interface and a repository engine. Files are the source of truth.

## Components

- **Desktop shell** provides filesystem access.
- **Repository engine** reads Markdown and runs native Git.
- **Interface** presents wiki, tasks, code, and history.

[Backend details](Architecture/Backend.md)
