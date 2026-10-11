# Writing pages

What GitDesk adds to Markdown besides [References](References.md), wherever it shows Markdown: wiki pages, task descriptions, task comments, and Markdown files previewed in **Code**. The source stays plain Markdown, so it reads well on GitHub and in any editor; GitDesk only shows it richer.

[TOC]

## Mentions

Write `@` and a person's handle to mention them: `@ada`. GitDesk shows the mention as a chip with the person's initials and name; hover it for their email, click it for a card with their name, handle and email and **Tasks assigned to …**, which opens the board filtered to their tasks.

Typing `@` in an editor or the comment box lists the repository's people. Keep typing to find someone by handle, name or email, and press `Enter` or `Tab` to insert their handle. The handle goes into the file, so the text reads `@ada` on GitHub too.

| You write | GitDesk shows |
| --- | --- |
| `@ada` | A chip with Ada's initials and name |
| `@nobody`, a handle no one has | `@nobody`, as written |
| `ada@example.com`, an email | The email, as written |
| `` `@ada` `` in code, or in a link | As written |

### Who is in the list

The repository's people are everyone who:

- authored one of the latest 5000 commits of the checked-out branch, with names and emails as `.mailmap` corrects them;
- is assigned a task, or wrote a comment on one;
- is listed under `people` in `.gitdesk.yml` — see [Settings](Settings.md#people).

The same person under several names or emails counts once: commits with the same email are one person, named as most of their commits name them, and names that match ignoring case are one person too. A person listed in the settings takes the commits, assignments and comments of their email and aliases.

### Handles

A handle is letters, digits, `-` and `_`, starting and ending with a letter or digit, up to 39 characters, like a GitHub username. Handles are unique, ignoring case:

1. A person listed in the settings has the handle written there.
2. Everyone else gets the part of their email before the `@` (`ada.lovelace@example.com` → `ada-lovelace`, GitHub's `123+ada@users.noreply.github.com` → `ada`), or their name when the email has none (`Grace Hopper` → `grace-hopper`).
3. When two people would get the same handle, the one whose email comes first alphabetically keeps it; the other tries their name, then their first name, then the handle with a number (`alex-2`).

A derived handle can change when a new person with the same email name joins. List people in the settings to pin their handles.

### Assignees

The **Assignee** menu of a task offers the same people and assigns their handle; **Someone else…** still takes any name. Cards, the list and the filters show assignees by name, however a task writes them — `assignee: ada`, `assignee: Ada Lovelace` and `assignee: ada@example.com` are the same person.

**Find mentions of me** in the command palette (`Ctrl+K`) searches pages, tasks and code for your handle, once your Git name or email is one of the repository's people.

## Dates

A date written as `2026-10-11` shows as a chip in your language, such as *11 Oct 2026*, with how far away it is as a tooltip (*in 3 days*, *2 weeks ago*). The file keeps the ISO date, which sorts, greps and reads the same everywhere.

In a task list, the date of an open item says when it is due: red once it has passed, yellow when it is today or within two days. Ticked items stay neutral.

```markdown
- [ ] Send the offer 2026-10-12
- [ ] Book the venue 2026-11-30
- [x] Agree on the budget 2026-10-01
```

Only whole, valid dates count: `2026-02-30`, `2026-10-11T10:00`, `notes/2026-10-11.md`, dates in code and in links stay as written.

### Inserting a date

Type `//` in an editor or the comment box for a list of dates: **Today**, **Tomorrow**, **Next Monday**, **In a week**, **End of month** and **Pick a date…**, a calendar (arrow keys move by day and week, `Page Up` and `Page Down` by month, `Enter` picks, `Esc` closes). Keep typing to narrow it down:

| Type | Inserts |
| --- | --- |
| `//tom` | Tomorrow |
| `//fri`, `//next fri` | The coming Friday |
| `//3d`, `//2w`, `//1m`, `//1y`, `//in 3 days` | That far from today |
| `//eom` | The last day of the month |
| `//2026-12-24` | That date |

`//` after a letter, a digit or a `:` starts nothing, so URLs such as `https://` type as usual, and neither does `//` in code.

Task fields of type `date` (see [Tasks](Tasks.md#custom-fields)) show on cards and in the list the same way, overdue in red until the task reaches the last workflow state.
