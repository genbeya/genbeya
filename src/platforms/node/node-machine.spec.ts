import childProcess from "node:child_process";
import { promises as fs } from "node:fs";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { TOO_MUCH_OUTPUT } from "../../access/ports";
import { describeMachine } from "../../testing/machine-contract";
import { temporaryFolder } from "../../testing/temp";
import { defaultShell, nodeMachine } from "./node-machine";

const TERMINAL_PROGRAM = `
const size = () => process.stdout.write("size " + process.stdout.columns + "x" + process.stdout.rows + "\\n");
size();
process.stdout.on("resize", size);
process.stdin.setRawMode(true);
process.stdin.on("data", (data) => (String(data) === "q" ? process.exit(7) : process.stdout.write("got " + data + "\\n")));
`;

describeMachine("Node", () => ({
  machine: nodeMachine(),
  folder: () => temporaryFolder("machine-"),
  echo: { command: process.execPath, args: ["-e", "process.stdin.pipe(process.stdout)"] },
  terminalProgram: { command: process.execPath, args: ["-e", TERMINAL_PROGRAM] },
  async link(target, path) {
    try {
      await fs.symlink(target, path, "junction");
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return false;
      throw error;
    }
  },
}));

describe("nodeMachine processes", () => {
  it("stop programs that write more than they may, and say so", async () => {
    const script = "const chunk = 'x'.repeat(1 << 20); for (let i = 0; i < 80; i++) process.stdout.write(chunk);";
    const result = await nodeMachine().processes.run(process.execPath, ["-e", script], { cwd: await temporaryFolder("output-") });
    expect(result).toMatchObject({ code: TOO_MUCH_OUTPUT, stderr: expect.stringContaining("more output") });
  });
});

describe("nodeMachine terminals", () => {
  it("pass arguments with quotes and spaces unchanged, as the SSH terminal command needs", async () => {
    const remote = `cd '/srv/it'\\''s here' && exec "$SHELL" -l`;
    const script = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
    const terminal = await nodeMachine().terminals!.open(process.execPath, ["-e", script, "--", "-t", remote], {
      cwd: await temporaryFolder("terminal-"),
      cols: 300,
      rows: 10,
    });
    let output = "";
    terminal.onData((data) => (output += data));
    await new Promise((resolve) => terminal.onExit(resolve));
    expect(output).toContain(JSON.stringify(["-t", remote]));
  });

  // node-pty's own kill forks a helper that attaches to the console to list its programs; when the
  // console closes first, which it does as the app quits, the helper prints "AttachConsole failed".
  it.skipIf(process.platform !== "win32")("end a Windows terminal and the programs in it without node-pty's helper", async () => {
    const fork = vi.spyOn(childProcess, "fork");
    onTestFinished(() => fork.mockRestore());
    const script = `const child = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
      process.stdout.write("pids " + process.pid + " " + child.pid + "\\n"); setInterval(() => {}, 1000);`;
    const terminal = await nodeMachine().terminals!.open(process.execPath, ["-e", script], {
      cwd: await temporaryFolder("terminal-"),
      cols: 100,
      rows: 10,
    });
    let output = "";
    terminal.onData((data) => (output += data));
    const exited = new Promise((resolve) => terminal.onExit(resolve));
    await expect.poll(() => /pids (\d+) (\d+)/.exec(output), { timeout: 10_000 }).not.toBeNull();
    const pids = /pids (\d+) (\d+)/.exec(output)!.slice(1).map(Number);
    terminal.kill();
    await exited;
    const running = (pid: number) => {
      try {
        return process.kill(pid, 0);
      } catch {
        return false;
      }
    };
    await expect.poll(() => pids.filter(running), { timeout: 10_000 }).toEqual([]);
    expect(fork.mock.calls.map(([module]) => String(module))).not.toContainEqual(expect.stringContaining("conpty_console_list_agent"));
  });
});

describe("defaultShell", () => {
  const on =
    (...programs: string[]) =>
    (program: string) =>
      programs.includes(program);

  it("prefers PowerShell 7, then Windows PowerShell, then COMSPEC on Windows", () => {
    const env = { COMSPEC: "C:\\Windows\\system32\\cmd.exe" };
    expect(defaultShell("windows", env, on("pwsh.exe", "powershell.exe"))).toBe("pwsh.exe");
    expect(defaultShell("windows", env, on("powershell.exe"))).toBe("powershell.exe");
    expect(defaultShell("windows", env, on())).toBe("C:\\Windows\\system32\\cmd.exe");
  });

  it("takes $SHELL elsewhere, or /bin/sh", () => {
    expect(defaultShell("macos", { SHELL: "/bin/zsh" }, on())).toBe("/bin/zsh");
    expect(defaultShell("linux", { SHELL: "" }, on())).toBe("/bin/sh");
    expect(defaultShell("linux", {}, on())).toBe("/bin/sh");
  });
});
