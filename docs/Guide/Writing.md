# Writing pages

Pages, task descriptions and comments are GitHub Flavored Markdown with a few additions for engineering docs. Everything on this page also reads well on GitHub: what GitHub does not know shows there as plain Markdown. [Wiki](Wiki.md) covers links, references, tables of contents, diagrams and images.

[TOC]

## Inserting blocks

In the editor, `/` at the start of a line lists blocks to insert: math, a diagram, callouts, a table, code, a diff, a collapsible section, a footnote and the table of contents. Pick one with the arrow keys and `Enter`, then `Tab` moves between its fields.

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
- Formulas GitDesk cannot read show their source in red; point at it for the reason.
- **Copy LaTeX**, at the top right of a formula on its own line, copies its source.

GitDesk typesets with [KaTeX](https://katex.org/docs/supported), which knows most of LaTeX's math. Commands that link or load something (`\href`, `\url`, `\includegraphics`, `\htmlClass`) show as red text instead.

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

` ```mermaid ` draws [Mermaid](https://mermaid.js.org/intro/) diagrams: flowcharts, sequence, class, state and entity-relationship diagrams, Gantt charts, timelines, mind maps, user journeys, pie and quadrant charts, Git graphs and more. ` ```plantuml ` draws PlantUML diagrams. Graphviz (` ```dot `) is not supported: its engine would add more than a megabyte to GitDesk, and Mermaid's flowcharts cover most of what it is used for.
