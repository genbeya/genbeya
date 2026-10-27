# Settings

**Settings** (`Ctrl+,`, or at the bottom of the sidebar) holds the project's shared settings and your own preferences. This page also describes every key of `.genbeya.yml`, for editing it by hand.

[TOC]

## The Settings view

| Section | What it holds | Shared with |
| --- | --- | --- |
| **Project** | Name, task ID prefix, wiki folder and home page, task folder, pull request folder and ID prefix, **Approvals needed**, **Workflow**, **Task types**, **Custom fields** | Everyone: saved to `.genbeya.yml` |
| **Where content lives** | Whether the wiki, the tasks, the settings and the pull requests live in the checkout or on the [Content branch](../Architecture/Content-branch.md), and **Sync automatically** | Everyone, through the content branch |
| **AI agents** | Files that teach coding agents to use the tasks and the wiki — see [AI agents](AI-agents.md) | Everyone, once committed |
| **Remotes** | Add, edit and remove Git remotes | This clone |
| **App** | Theme, **Reopen last repository** on start, **Show minimap** in the editor, **Editor font** and **Ligatures** | This computer |
| **Help** | The version, **Start the tour**, **Show what's new**, **Open the documentation** | — |

Changes to **Project** wait for **Save** (`Ctrl+S`) or **Discard**; everything else applies right away. Saving writes `.genbeya.yml`, an ordinary change to commit in **Changes** — unless the settings live on the content branch, where the save is committed right away.

## .genbeya.yml

`.genbeya.yml` sits at the root of the checkout, or of the content branch when the settings live there. Every key is optional; a repository without the file uses the defaults below. This is Genbeya's own file:

```yaml
name: Genbeya
wikiRoot: docs
wikiHome: Home.md
taskRoot: tasks
taskPrefix: GENBEYA
statuses:
  - backlog
  - todo
  - in-progress
  - review
  - done
```

Genbeya rewrites only the keys whose values you changed. Comments, keys it does not know and the spelling of everything else stay as they are, so the file can be edited by hand and in **Settings** alike.

### Project

| Key | Type | Default | Meaning |
| --- | --- | --- | --- |
| `name` | text, up to 120 characters | The repository's folder name | The project's name, shown at the top of the sidebar |
| `wikiRoot` | folder | `docs` | The wiki folder, relative to the repository root |
| `wikiHome` | Markdown file | `Home.md` | The wiki's first page, relative to `wikiRoot` |
| `taskRoot` | folder | `tasks` | The task folder. It must not contain the wiki folder, nor the other way round |
| `taskPrefix` | letters and digits, starting with a letter, up to 12 | From the name: its capitals (`TaskBoard` → `TB`), the first letters of its words (`my project` → `MP`), or its first three letters (`atlas` → `ATL`) | New tasks are `TB-1`, `TB-2`, … Written in capitals |
| `pullRoot` | folder | `pulls` | The [pull request](Pull-requests.md) folder. It must not contain the wiki or task folder, nor sit inside them |
| `pullPrefix` | letters and digits, starting with a letter, up to 12 | `PR` | New pull requests are `PR-1`, `PR-2`, … |
| `requiredApprovals` | whole number, 0 to 20 | `1` | How many effective approvals a pull request needs to count as ready to merge. Genbeya advises; protected branches on the Git host enforce |

Changing a folder does not move any files: move them first, then change the setting. Changing the prefix leaves existing IDs as they are.

### statuses

The workflow states, in board order: the board's columns, left to right. The last one counts as done. 1 to 12 unique names of up to 40 characters.

```yaml
statuses:
  - todo
  - name: in-progress   # a state with its own icon
    icon: play
  - name: done
    icon: flag
```

A state is written as a name, or as `name` and `icon` once it has an icon. Without an icon, a column shows a ring that fills as work advances, and a check for the last state. Default: `backlog`, `todo`, `in-progress`, `review`, `done`.

Renaming or removing a state does not change any task. Tasks in a state that is no longer listed appear in an extra column, so nothing gets lost.

### hiddenColumns

States the board leaves out; the list still shows their tasks. Each must be one of the `statuses`.

```yaml
hiddenColumns:
  - backlog
```

Unticking a state in the list layout writes this key for everyone. The key is left out while no column is hidden.

### types

The task types. Default: `bug`, `feature`, `improvement`, `chore`. `types: []` turns types off.

```yaml
types:
  - name: bug
    icon: bug
    tone: red         # gray, blue, green, yellow, orange, red or purple
  - name: spike
    icon: flask-conical
  - feature           # a name alone brings its usual icon and colour
```

- A name alone uses the type's usual icon and colour. Well-known names have their own: bug, feature, improvement, chore, task, story, docs, question, research. Others get a generic icon.
- Written out, a type needs `name` and `icon`; `tone` is optional.
- Names use letters, digits, spaces, `-` and `_`, up to 40 characters, unique ignoring case. Up to 20 types.
- Each type's description template is `<taskRoot>/.templates/<name>.md` — see [Tasks](Tasks.md#templates).

### fields

Custom task fields, edited under a task's properties and saved to its frontmatter. Up to 30.

```yaml
fields:
  - name: estimate
    type: number
  - name: due
    type: date        # written as 2026-05-01
  - name: area
    type: choice
    options: [ui, backend, docs]
  - name: reviewer    # text, unless a type is given
```

| `type` | Value in a task |
| --- | --- |
| `text` (the default) | Any text |
| `number` | A number |
| `date` | `YYYY-MM-DD` |
| `choice` | One of `options`: 1 to 30 unique values of up to 60 characters |
| `effort` | Hours or days of work: `16h`, `2d` (8 hours), or a number of hours |
| `tasks` | Task IDs, as a list: `[PW-2, PW-3]` |

The names `estimate`, `remaining`, `duration`, `start`, `due`, `milestone` and `depends_on` also plan; see [Planning](Tasks.md#planning).

Names start with a letter and use letters, digits, `-` and `_`, up to 40 characters, unique ignoring case. Genbeya's own task keys are taken: `id`, `title`, `type`, `status`, `priority`, `assignee`, `labels`, `epic`. The key is left out while there are no fields.

### people

The project's people, for `@mentions` and the **Assignee** menu. Genbeya finds people on its own, from commits, assignees and comments (see [Writing pages](Writing.md#who-is-in-the-list)); list them here to give them a handle of your choice, a name, or to join several names and emails into one person. Up to 500.

```yaml
people:
  - handle: ada
    name: Ada Lovelace
    email: ada@example.com
    aliases: [Ada King, ada@old.example]   # other names and emails of the same person
  - handle: grace
    name: Grace Hopper
```

- `handle` and `name` are required. Handles use letters, digits, `-` and `_`, starting and ending with a letter or digit, up to 39 characters, unique ignoring case.
- `email` and `aliases` are optional. Commits, assignees and comments under the email or an alias count as this person; an alias shaped like a handle also mentions them (`@lovelace`). An alias must not be another person's handle.
- A listed person keeps their handle; people Genbeya derives handles for get others when they would clash.

The key is left out while no one is listed; **Settings** keeps it as written.

### Icons

`icon` of a state or a type names one of these [Lucide](https://lucide.dev/icons) icons, which **Settings** offers in its icon picker:

`bug`, `sparkles`, `trending-up`, `wrench`, `square-check`, `book-open`, `file-text`, `circle-question-mark`, `flask-conical`, `lightbulb`, `shield`, `zap`, `palette`, `gauge`, `rocket`, `circle-dot`, `circle`, `circle-dashed`, `circle-check`, `circle-x`, `clock`, `eye`, `play`, `pause`, `ban`, `archive`, `inbox`, `flag`

Any other name shows a generic icon.

## .genbeya-content

When a [Content branch](../Architecture/Content-branch.md) exists, the file `.genbeya-content` at its root says where each area lives. Genbeya writes it whenever an area moves in **Settings → Where content lives**; there is no need to edit it.

```ini
# Where Genbeya keeps each area: "branch" is this content branch,
# "checkout" is the checked-out code branch of every clone.
[areas]
	wiki = checkout
	tasks = branch
	settings = checkout
	pulls = branch
```

Areas it does not name live in the checkout. A content branch without the file holds every area, as content branches did before areas could be split.

## Git configuration

Two keys of `git config` change how Genbeya treats one clone:

| Key | Meaning |
| --- | --- |
| `genbeya.branch` | The name of the content branch, instead of `genbeya` |
| `genbeya.storage` | `worktree` keeps every area of this clone in its checkout, whatever the team's layout: a personal opt-out. Choosing a layout in **Settings** removes it |

```bash
git config genbeya.branch team-content
```

## Personal preferences

Theme, **Reopen last repository**, **Show minimap**, the editor font, ligatures, recent repositories and what the onboarding has shown you are stored per variant in the app's data folder (`state.json`), not in the repository.

**Editor font** picks the font of the editors and of code in pages: JetBrains Mono (the default), Fira Code, Cascadia Code or Roboto Mono, all shipped with Genbeya. **Ligatures** lets the font join characters into one glyph, such as `->` into an arrow or `<=` into ≤; Roboto Mono has none.
