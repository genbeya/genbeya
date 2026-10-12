# Writing pages

What Genbeya adds to Markdown besides [References](References.md), wherever it shows Markdown: wiki pages, task descriptions, task comments, and Markdown files previewed in **Code**. The source stays plain Markdown, so it reads well on GitHub and in any editor; Genbeya only shows it richer. What GitHub does not know shows there as plain Markdown. [Wiki](Wiki.md) covers links, tables of contents, diagrams and images.

[TOC]

## Inserting blocks

In the editor of pages and task descriptions, `/` at the start of a line lists blocks to insert: math, a diagram, callouts, a table, code, a diff, a collapsible section, a footnote and the table of contents. Pick one with the arrow keys and `Enter`, then `Tab` moves between its fields.

## Mentions

Write `@` and a person's handle to mention them: `@ada`. Genbeya shows the mention as a chip with the person's initials and name; hover it for their email, click it for a card with their name, handle and email and **Tasks assigned to …**, which opens the board filtered to their tasks.

Typing `@` in an editor or the comment box lists the repository's people. Keep typing to find someone by handle, name or email, and press `Enter` or `Tab` to insert their handle. The handle goes into the file, so the text reads `@ada` on GitHub too.

| You write | Genbeya shows |
| --- | --- |
| `@ada` | A chip with Ada's initials and name |
| `@nobody`, a handle no one has | `@nobody`, as written |
| `ada@example.com`, an email | The email, as written |
| `` `@ada` `` in code, or in a link | As written |

### Who is in the list

The repository's people are everyone who:

- authored one of the latest 5000 commits of the checked-out branch, with names and emails as `.mailmap` corrects them;
- is assigned a task, or wrote a comment on one;
- is listed under `people` in `.genbeya.yml` — see [Settings](Settings.md#people).

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

## Math

Write LaTeX between dollar signs, as on GitHub:

| Write | For |
| --- | --- |
| `$E = mc^2$` | A formula in the text: $E = mc^2$ |
| `` $`a^2 + b^2`$ `` | The same, for formulas with dollar signs or other Markdown in them |
| `$$` on lines of their own around the formula | A formula on its own line |
| ` ```math ` | The same, as a code block |

$$
\int_0^1 x^2 \, dx = \frac{1}{3}
$$

A dollar sign only starts a formula when a non-space follows it, and only ends one after a non-space and before anything but a digit — so prices such as $5 and $10 stay text. Write `\$` for a dollar sign that should never start one.

- In the editor, the formula under the cursor shows typeset in a tooltip.
- Formulas Genbeya cannot read show their source in red; point at it for the reason.
- **Copy LaTeX**, at the top right of a formula on its own line, copies its source.

Genbeya typesets with [KaTeX](https://katex.org/docs/supported), which knows most of LaTeX's math. Commands that link or load something (`\href`, `\url`, `\includegraphics`, `\htmlClass`) show as red text instead.

## Code blocks

After the language, a code block takes the options Docusaurus uses; GitHub ignores them:

| Write | Get |
| --- | --- |
| ` ```ts title="src/app.ts" ` | The file name above the code |
| ` ```ts showLineNumbers ` | Line numbers; `showLineNumbers=10` starts at 10 |
| ` ```ts {2,4-6} ` | Lines 2 and 4 to 6 highlighted |
| ` ```ts ins={3} del={4} ` | Line 3 marked as added, line 4 as removed |
| ` ```diff ` | Added and removed lines in green and red |
| ` ```diff-ts ` | The same, with the code highlighted as TypeScript |

```diff
- const timeout = 1000;
+ const timeout = 5000;
```

Every code block has buttons to wrap long lines and to copy the code.

## Callouts

GitHub's alerts — `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` and `[!CAUTION]` — get a few additions known from Obsidian:

```markdown
> [!WARNING] Mind the migration
> A title after the marker replaces "Warning".

> [!TIP]- Folded
> `-` starts the callout folded; click its title to open it.

> [!NOTE]+ Open
> `+` makes it foldable, but open.
```

More kinds share the colours of the five: `info`, `todo`, `abstract`, `summary` and `quote` look like a note; `hint`, `success` and `done` like a tip; `example` and `question` like important; `attention` like a warning; `danger`, `error`, `bug` and `failure` like caution. GitHub shows callouts with these additions as quotes.

## Footnotes

Mark a footnote with `[^1]` and write it anywhere in the page as `[^1]: The note.`[^note] Notes are listed at the end of the page; pointing at a footnote shows its note, and the arrow after a note leads back.

[^note]: Like this one.

## Keys and collapsible sections

Pages leave out HTML, except for the few tags GitHub documents use:

| Write | Get |
| --- | --- |
| `<kbd>Ctrl</kbd>+<kbd>S</kbd>` | Keys: <kbd>Ctrl</kbd>+<kbd>S</kbd> |
| `H<sub>2</sub>O`, `x<sup>2</sup>` | H<sub>2</sub>O, x<sup>2</sup> |
| `<br>` | A line break, for example in a table cell |
| `<details>` with a `<summary>` | A section that opens on click |

<details>
<summary>A collapsible section</summary>

Leave a blank line after `</summary>` and before `</details>`, and Markdown inside works as anywhere else.

</details>

The tags must be written exactly like this, without attributes (`<details open>` starts the section open).

## Diagrams

` ```mermaid ` draws [Mermaid](https://mermaid.js.org/intro/) diagrams: flowcharts, sequence, class, state and entity-relationship diagrams, Gantt charts, timelines, mind maps, user journeys, pie and quadrant charts, Git graphs and more. ` ```plantuml ` draws PlantUML diagrams. Graphviz (` ```dot `) is not supported: its engine would add more than a megabyte to Genbeya, and Mermaid's flowcharts cover most of what it is used for.
