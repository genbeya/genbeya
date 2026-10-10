import { describe, expect, it } from "vitest";
import type { TerminalRunner } from "../access/ports";
import { connectManagers, dispatch } from "../contracts/rpc";
import { nodeMachine } from "../platforms/node/node-machine";
import { createRepository, onTestFinished } from "../testing/repository";
import { temporaryFolder } from "../testing/temp";
import { fakeTerminalRunner } from "../testing/terminals";
import { createBackend } from "./backend";

/** Managers on this machine, with fake pseudo-terminals, and an open repository. */
async function opened(terminals: TerminalRunner | null = fakeTerminalRunner("/bin/zsh").runner) {
  const backend = await createBackend({ ...nodeMachine(), terminals }, await temporaryFolder("data-"));
  onTestFinished(() => backend.dispose());
  const managers = connectManagers((request) => dispatch(backend, structuredClone(request)));
  const repository = await createRepository();
  const { id } = await managers.workspace.open({ kind: "local", path: repository.root });
  return { backend, managers, repository, id, terminal: managers.terminal };
}

async function withTerminal() {
  const { runner, opened: started } = fakeTerminalRunner("/bin/zsh");
  const open = await opened(runner);
  const id = await open.terminal.open(open.id, 100, 30);
  return { ...open, terminalId: id, started, fake: () => started[0]!.terminal };
}

describe("TerminalManager", () => {
  it("tells whether this build has terminals", async () => {
    expect(await (await opened()).terminal.available()).toBe(true);
    const without = await opened(null);
    expect(await without.terminal.available()).toBe(false);
    await expect(without.terminal.open(without.id, 80, 24)).rejects.toThrow("The terminal is not available in this build.");
  });

  it("starts the user's login shell in the repository's root", async () => {
    const { started, repository } = await withTerminal();
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ command: "/bin/zsh", args: ["-l"], options: { cols: 100, rows: 30 } });
    expect(started[0]!.options.cwd!.toLowerCase()).toBe(repository.root.toLowerCase());
  });

  it("streams output, passes input and size changes, and reports the exit", async () => {
    const { terminal, terminalId, fake } = await withTerminal();
    const reading = terminal.read(terminalId);
    fake().print("$ ");
    expect(await reading).toEqual({ data: "$ " });
    await terminal.write(terminalId, "exit\r");
    await terminal.resize(terminalId, 120, 40);
    expect(fake().write).toHaveBeenCalledWith("exit\r");
    expect(fake().resize).toHaveBeenCalledWith(120, 40);
    fake().exit(0);
    expect(await terminal.read(terminalId)).toEqual({ exit: 0 });
  });

  it("ends a terminal on close", async () => {
    const { terminal, terminalId, fake } = await withTerminal();
    await terminal.close(terminalId);
    expect(fake().kill).toHaveBeenCalled();
    await expect(terminal.read(terminalId)).rejects.toThrow("This terminal is closed.");
    await terminal.close(terminalId);
  });

  it("ends the repository's terminals when it closes", async () => {
    const { managers, id, terminal, terminalId, fake } = await withTerminal();
    await managers.workspace.close(id);
    expect(fake().kill).toHaveBeenCalled();
    await expect(terminal.write(terminalId, "x")).rejects.toThrow("This terminal is closed.");
    await expect(terminal.open(id, 80, 24)).rejects.toThrow("This repository is no longer open.");
  });

  it("ends the terminals of a client that reloaded, keeping the repository open for the new one", async () => {
    const { managers, terminal, terminalId, fake, started } = await withTerminal();
    const restored = await managers.workspace.restore([]);
    expect(fake().kill).toHaveBeenCalled();
    await expect(terminal.write(terminalId, "x")).rejects.toThrow("This terminal is closed.");
    await terminal.open(restored!.id, 80, 24);
    expect(started).toHaveLength(2);
    expect(started[1]!.terminal.kill).not.toHaveBeenCalled();
  });

  it("ends a shell that finishes starting after its repository closed", async () => {
    const { runner, opened: started } = fakeTerminalRunner("/bin/zsh");
    let release: () => void = () => undefined;
    const starting = new Promise<void>((resolve) => (release = resolve));
    const slow: TerminalRunner = { shell: runner.shell, open: async (...args) => (await starting, runner.open(...args)) };
    const { managers, id, terminal } = await opened(slow);
    const opening = terminal.open(id, 80, 24);
    await managers.workspace.close(id);
    release();
    await expect(opening).rejects.toThrow("This repository is no longer open.");
    expect(started[0]!.terminal.kill).toHaveBeenCalled();
  });

  it("ends every terminal when the app quits", async () => {
    const { backend, fake } = await withTerminal();
    await backend.dispose();
    expect(fake().kill).toHaveBeenCalled();
  });

  // Long strings are named by their length: a megabyte in a test name takes many minutes to print on Windows runners.
  const label = (args: readonly unknown[]) =>
    JSON.stringify(args, (_, value: unknown) => (typeof value === "string" && value.length > 40 ? `<${value.length} characters>` : value));
  const invalid = [
    ["open", ["w", 80, 24]],
    ["open", ["ID", 0, 24]],
    ["open", ["ID", 80, 1.5]],
    ["open", ["ID", "80", 24]],
    ["open", ["ID", 80, 100_000]],
    ["write", ["T", 42]],
    ["write", ["T", "x".repeat(1_000_001)]],
    ["write", ["made-up", "x"]],
    ["resize", ["T", -1, 24]],
    ["resize", [{}, 80, 24]],
    ["read", [null]],
  ] as const;
  it.each(invalid.map(([method, args]) => ({ method, args, label: label(args) })))("validates $method $label", async ({ method, args }) => {
    const { terminal, id, terminalId, fake } = await withTerminal();
    const resolved = args.map((arg) => (arg === "ID" ? id : arg === "T" ? terminalId : arg));
    const call = (terminal as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method]!(...resolved);
    await expect(call).rejects.toThrow();
    expect(fake().write).not.toHaveBeenCalled();
    expect(fake().resize).not.toHaveBeenCalled();
  });
});
