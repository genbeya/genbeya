# Keyboard shortcuts

On macOS, use `⌘` where this page says `Ctrl`, except for `` Ctrl+` ``: macOS switches windows with `` ⌘+` ``, so the terminal keeps `Ctrl` there.

| Keys | Action |
| --- | --- |
| `Ctrl+K`, `Ctrl+P` | Search pages, tasks, files and commands |
| `Ctrl+Shift+F`, or `/` first in the `Ctrl+K` palette | [[Search]] inside pages, tasks and files |
| `Alt+C`, `Alt+W`, `Alt+R` | While searching inside files: match case, whole words, regular expression |
| `Ctrl+1` … `Ctrl+5` | Wiki, Tasks, Code, Changes, History |
| `Ctrl+,` | Settings |
| `` Ctrl+` `` | Show or hide the [[Terminal]] |
| `Alt+←` / `Alt+→`, mouse back/forward | Back / forward |
| `Ctrl+O` | Open a folder |
| `/` | Focus the filter of the current view |
| `?` | Show shortcuts |
| `E` | Edit the open page or task |
| `N` | New page |
| `C` | New task |
| `Ctrl+S` | Save |
| `Esc` | Stop editing, close the task panel |
| `Ctrl+Enter` | Commit (Changes), save (task) |
| Context-menu key, `Shift+F10` | Copy a link to the focused page, task, file or commit |

While a terminal has focus, every key except `` Ctrl+` `` goes to the shell.

## In the editor

The editor for code, pages and tasks follows VS Code; see [[Code]]. Where macOS differs by more than `⌘` for `Ctrl`, the second column says so.

| Keys | macOS | Action |
| --- | --- | --- |
| `Ctrl+F` | | Find; takes the selected text |
| `Ctrl+H` | `⌥⌘F` | Find and replace |
| `Enter` / `Shift+Enter`, `F3` / `Shift+F3` | also `⌘G` / `⇧⌘G` | Next / previous match |
| `Alt+Enter` (in the find field) | | Select all matches |
| `Enter` / `Ctrl+Alt+Enter` (in the replace field) | | Replace / replace all |
| `Alt+C`, `Alt+W`, `Alt+R`, `Alt+L` (in the find bar) | `⌥⌘C`, `⌥⌘W`, `⌥⌘R`, `⌥⌘L` | Match case, whole word, regular expression, find in selection |
| `Esc` | | Close the find bar; then back to one cursor; then stop editing |
| `Ctrl+G` | `⌃G` | Go to line |
| `Ctrl+D` | | Select the next occurrence |
| `Ctrl+Shift+L` | | Select all occurrences |
| `Alt`+click | `⌥`+click | Add a cursor |
| `Ctrl+Alt+↑` / `↓` | | Add a cursor above / below |
| `Shift+Alt`+drag, middle-button drag | | Select a rectangle |
| `Ctrl+L` | | Select the line (again: the next one too) |
| `Alt+↑` / `Alt+↓` | | Move the line |
| `Shift+Alt+↑` / `Shift+Alt+↓` | | Copy the line |
| `Ctrl+Shift+K` | | Delete the line |
| `Ctrl+Enter` | | Insert a line below |
| `Ctrl+/` | | Toggle line comment |
| `Ctrl+]` / `Ctrl+[`, `Tab` / `Shift+Tab` | | Indent / outdent |
| `Ctrl+Shift+\` | | Go to the matching bracket |
| `Ctrl+Shift+[` / `Ctrl+Shift+]` | `⌥⌘[` / `⌥⌘]` | Fold / unfold the block |
| `Ctrl+Alt+[` / `Ctrl+Alt+]` | `⌃⌥[` / `⌃⌥]` | Fold / unfold everything |
| `Alt+Z` | `⌥Z` | Word wrap on or off |
| `Ctrl+Z` / `Ctrl+Y`, `Ctrl+Shift+Z` | `⌘Z` / `⇧⌘Z` | Undo / redo |

Inside the editor these keys win over GitDesk's own: `Alt+←` / `Alt+→` move the cursor there (by syntax element; by word on macOS) instead of going back and forward, and `Ctrl+Enter` inserts a line instead of saving a task. `Ctrl+K`, `Ctrl+P`, `Ctrl+Shift+F`, `Ctrl+1` … `Ctrl+5`, `Ctrl+,`, `Ctrl+O`, `Ctrl+S` and `` Ctrl+` `` work in the editor as everywhere. Characters typed with `AltGr` (such as `[` `]` `\` `{` `}` on Swiss and German keyboards) are always typed, never taken for `Ctrl+Alt` shortcuts.
