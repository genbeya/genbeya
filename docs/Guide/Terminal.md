# Terminal

Press `` Ctrl+` `` (also on macOS, where `` ⌘+` `` switches windows), or choose **Toggle terminal** in the command palette, to open a terminal at the bottom of the window. It starts in the repository's root folder, on the machine the repository lives on, and stays open while you switch views. On layouts without a `` ` `` key, use the key left of `1` (`Ctrl+§` on a Swiss keyboard).

| Repository | Shell |
| --- | --- |
| Local, Windows | PowerShell 7 (`pwsh`) if installed, else Windows PowerShell, else `COMSPEC` |
| Local, macOS and Linux | Your login shell (`$SHELL`, else `/bin/sh`) |
| WSL | The distribution's default shell, through `wsl.exe --cd` |
| SSH | Your login shell on the server, through `ssh -t`. Answer password and host key prompts in the terminal |

- **+** opens another terminal, **×** closes one, and the arrow hides the panel without ending anything. Drag the panel's top edge to resize it.
- On the tabs, `←` and `→` (or `Home` and `End`) move between terminals, `Enter` opens one and `Delete` closes it.
- Typing `exit` closes the terminal. A shell that ends with an error stays open, so its last output can be read.
- While the terminal has focus it receives every key except `` Ctrl+` ``, so app shortcuts such as `Ctrl+K` go to the shell. On Windows and Linux `Ctrl+C` copies when text is selected and interrupts otherwise, and `Ctrl+V` pastes; on macOS use `⌘C` and `⌘V`.
- Closing the repository ends its terminals.

> [!NOTE]
> The Deno Desktop build has no terminal: Deno cannot run the native pseudo-terminal module GitDesk uses. Electron and Tauri builds have one.
