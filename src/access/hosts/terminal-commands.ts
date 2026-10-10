/**
 * How each host starts an interactive shell in a repository. The command
 * runs on this machine's pseudo-terminal; for WSL and SSH it reaches the
 * other machine itself.
 */
import { quote } from "./shell-session";

export interface TerminalCommand {
  readonly command: string;
  readonly args: readonly string[];
  /** The local working directory; WSL and SSH shells change into the repository themselves. */
  readonly cwd?: string;
}

/** The user's shell: a login shell on macOS and Linux, so it has the user's PATH; PowerShell without its banner. */
export function localTerminal(shell: string, path: string): TerminalCommand {
  const name = shell.slice(Math.max(shell.lastIndexOf("/"), shell.lastIndexOf("\\")) + 1).toLowerCase();
  if (!name.endsWith(".exe")) return { command: shell, args: ["-l"], cwd: path };
  return { command: shell, args: name === "pwsh.exe" || name === "powershell.exe" ? ["-NoLogo"] : [], cwd: path };
}

/** The distribution's default shell; the distribution name was validated by the host factory. */
export function wslTerminal(distro: string, path: string): TerminalCommand {
  return { command: "wsl.exe", args: ["-d", distro, "--cd", path] };
}

/**
 * The user's login shell over SSH. Unlike the backend's connection this one
 * is interactive (no BatchMode), so the user can answer password and host
 * key prompts in the terminal. The remote login shell runs the command line.
 */
export function sshTerminal(host: string, path: string): TerminalCommand {
  return { command: "ssh", args: ["-t", "--", host, `cd ${quote(path)} && exec "$SHELL" -l`] };
}
