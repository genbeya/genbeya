import { promises as fs } from "node:fs";
import { describe, expect, it } from "vitest";
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
