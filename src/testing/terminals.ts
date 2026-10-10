/** Pseudo-terminals for tests: programs that print and exit when the test says so. */
import { vi } from "vitest";
import type { TerminalOptions, TerminalRunner } from "../access/ports";

export function fakeTerminal() {
  const listeners = { data: [] as ((data: string) => void)[], exit: [] as ((code: number) => void)[] };
  return {
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: (listener: (data: string) => void) => void listeners.data.push(listener),
    onExit: (listener: (code: number) => void) => void listeners.exit.push(listener),
    print: (data: string) => listeners.data.forEach((listener) => listener(data)),
    exit: (code: number) => listeners.exit.forEach((listener) => listener(code)),
  };
}

export type FakeTerminal = ReturnType<typeof fakeTerminal>;

/** A runner whose `opened` lists every start, with the fake terminal it returned. */
export function fakeTerminalRunner(shell = "sh") {
  const opened: { command: string; args: readonly string[]; options: TerminalOptions; terminal: FakeTerminal }[] = [];
  const runner: TerminalRunner = {
    shell: async () => shell,
    async open(command, args, options) {
      const terminal = fakeTerminal();
      opened.push({ command, args, options, terminal });
      return terminal;
    },
  };
  return { runner, opened };
}
