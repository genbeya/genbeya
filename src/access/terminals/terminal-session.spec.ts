import { describe, expect, it } from "vitest";
import { fakeTerminalRunner } from "../../testing/terminals";
import type { Host } from "../hosts/host";
import { TerminalSession } from "./terminal-session";

async function session() {
  const { runner, opened } = fakeTerminalRunner();
  const host = { terminalCommand: async (path: string) => ({ command: "ssh", args: ["host", path] }) } as unknown as Host;
  const started = await TerminalSession.open(runner, host, "/repo", { cols: 80, rows: 24 });
  return { session: started, opened, terminal: opened[0]!.terminal };
}

describe("TerminalSession", () => {
  it("starts the host's shell for the repository at the terminal's size, as a colour terminal", async () => {
    const { opened } = await session();
    expect(opened[0]).toMatchObject({
      command: "ssh",
      args: ["host", "/repo"],
      options: { cols: 80, rows: 24, env: { TERM: "xterm-256color", COLORTERM: "truecolor" } },
    });
  });

  it("hands out everything printed since the last read", async () => {
    const { terminal, session: opened } = await session();
    terminal.print("one ");
    terminal.print("two");
    expect(await opened.read()).toEqual({ data: "one two" });
    const next = opened.read();
    terminal.print("three");
    expect(await next).toEqual({ data: "three" });
  });

  it("answers an empty read when nothing arrives in time", async () => {
    const { session: opened } = await session();
    expect(await opened.read(10)).toEqual({ data: "" });
  });

  it("reports the exit once the output is read", async () => {
    const { terminal, session: opened } = await session();
    const waiting = opened.read();
    terminal.print("bye");
    terminal.exit(3);
    expect(await waiting).toEqual({ data: "bye" });
    expect(await opened.read()).toEqual({ exit: 3 });
    expect(await opened.read()).toEqual({ exit: 3 });
  });

  it("keeps only the most recent output while nobody reads", async () => {
    const { terminal, session: opened } = await session();
    for (let i = 0; i < 20; i++) terminal.print(`${i}`.padEnd(100_000, "."));
    const { data } = (await opened.read()) as { data: string };
    expect(data.length).toBeLessThanOrEqual(1_000_000);
    expect(data.endsWith("19".padEnd(100_000, "."))).toBe(true);
  });

  it("passes input and size changes to the program and kills it on close", async () => {
    const { terminal, session: opened } = await session();
    opened.write("ls\r");
    opened.resize(120, 40);
    const waiting = opened.read();
    opened.close();
    expect(terminal.write).toHaveBeenCalledWith("ls\r");
    expect(terminal.resize).toHaveBeenCalledWith(120, 40);
    expect(terminal.kill).toHaveBeenCalled();
    // A pending read ends rather than waiting for a program that is gone.
    expect(await waiting).toEqual({ data: "" });
  });
});
