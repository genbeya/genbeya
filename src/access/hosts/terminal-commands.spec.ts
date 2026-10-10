import { describe, expect, it } from "vitest";
import { localTerminal, sshTerminal, wslTerminal } from "./terminal-commands";

describe("terminal commands", () => {
  it("starts a local shell in the repository, as a login shell on macOS and Linux", () => {
    expect(localTerminal("/bin/zsh", "/home/me/repo")).toEqual({ command: "/bin/zsh", args: ["-l"], cwd: "/home/me/repo" });
    expect(localTerminal("pwsh.exe", "C:\\repo")).toEqual({ command: "pwsh.exe", args: ["-NoLogo"], cwd: "C:\\repo" });
    expect(localTerminal("powershell.exe", "C:\\repo").args).toEqual(["-NoLogo"]);
    expect(localTerminal("C:\\Windows\\system32\\cmd.exe", "C:\\repo").args).toEqual([]);
  });

  it("starts the distribution's shell in the repository on WSL", () => {
    expect(wslTerminal("Ubuntu 24.04", "/home/me/my repo")).toEqual({
      command: "wsl.exe",
      args: ["-d", "Ubuntu 24.04", "--cd", "/home/me/my repo"],
    });
  });

  it("starts the login shell in the repository over an interactive SSH connection", () => {
    const { command, args } = sshTerminal("me@example.com", "/srv/repo");
    expect(command).toBe("ssh");
    // Interactive: a terminal, and no BatchMode, so the user can answer password and host key prompts.
    expect(args).toEqual(["-t", "--", "me@example.com", `cd '/srv/repo' && exec "$SHELL" -l`]);
  });

  it("quotes the remote path for the remote shell", () => {
    const remote = sshTerminal("host", "/srv/it's $(here) `now`; rm -rf ~").args.at(-1);
    expect(remote).toBe(`cd '/srv/it'\\''s $(here) \`now\`; rm -rf ~' && exec "$SHELL" -l`);
  });
});
