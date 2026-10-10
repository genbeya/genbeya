import type { Channel } from "@tauri-apps/api/core";
import { describe, expect, it } from "vitest";
import { FileSystemError } from "../../access/ports";
import { decodeLenient, encodeText } from "../../utilities/bytes";
import { tauriFileSystem, tauriProcesses, tauriTerminals } from "./tauri-machine";

interface Call {
  command: string;
  args: unknown;
  headers?: Record<string, string>;
}

/** An invoke that records calls and answers like the Rust commands. */
function fakeInvoke(answer: (call: Call) => unknown) {
  const calls: Call[] = [];
  const run = (async (command: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
    const call = { command, args, ...(options?.headers ? { headers: options.headers } : {}) };
    calls.push(call);
    return answer(call);
  }) as never;
  return { run, calls };
}

function frame(code: number, stdout: string, stderr: string): ArrayBuffer {
  const out = encodeText(stdout);
  const err = encodeText(stderr);
  const buffer = new ArrayBuffer(8 + out.length + err.length);
  const view = new DataView(buffer);
  view.setInt32(0, code, true);
  view.setUint32(4, err.length, true);
  new Uint8Array(buffer).set(err, 8);
  new Uint8Array(buffer).set(out, 8 + err.length);
  return buffer;
}

describe("tauriFileSystem", () => {
  it("sends file contents as raw bytes with the path in a header", async () => {
    const { run, calls } = fakeInvoke(() => null);
    await tauriFileSystem(run).writeFile("C:\\a b\\ü.md", encodeText("x"), true);
    expect(calls[0]).toMatchObject({ command: "fs_write", headers: { path: "C%3A%5Ca%20b%5C%C3%BC.md", exclusive: "1" } });
    expect(calls[0]!.args).toBeInstanceOf(Uint8Array);
  });

  it("maps command failures to FileSystemErrors", async () => {
    const { run } = fakeInvoke(() => Promise.reject({ code: "ENOENT", message: "missing" }));
    const failure = await tauriFileSystem(run)
      .stat("x")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(FileSystemError);
    expect(failure).toMatchObject({ code: "ENOENT", message: "missing" });
    const { run: odd } = fakeInvoke(() => Promise.reject("boom"));
    await expect(tauriFileSystem(odd).list("x")).rejects.toMatchObject({ code: "EIO", message: "boom" });
  });

  it("reads files as bytes", async () => {
    const { run } = fakeInvoke(() => encodeText("hi").buffer);
    expect(decodeLenient(await tauriFileSystem(run).readFile("a"))).toBe("hi");
  });
});

describe("tauriProcesses", () => {
  it("decodes the framed reply of a run", async () => {
    const { run, calls } = fakeInvoke(() => frame(3, "out", "err"));
    const result = await tauriProcesses(run).run("git", ["status"], { cwd: "/r", timeout: 5, env: { A: "1" } });
    expect({ code: result.code, stdout: decodeLenient(result.stdout), stderr: result.stderr }).toEqual({
      code: 3,
      stdout: "out",
      stderr: "err",
    });
    expect(calls[0]!.args).toEqual({ command: "git", args: ["status"], cwd: "/r", env: { A: "1" }, timeoutMs: 5 });
  });

  it("streams a spawned process's output and exit, and writes in order", async () => {
    let channel: { onmessage: (message: ArrayBuffer) => void } | undefined;
    const { run, calls } = fakeInvoke(async (call) => (call.command === "proc_spawn" ? 7 : null));
    const processes = tauriProcesses(run, () => (channel = { onmessage: () => undefined }) as unknown as Channel<ArrayBuffer>);
    const child = processes.spawn("sh", []);
    const output: string[] = [];
    const exit = new Promise<number>((resolve) => child.onExit(resolve));
    child.onStdout((chunk) => output.push(decodeLenient(chunk)));
    child.write(encodeText("one"));
    child.write(encodeText("two"));
    child.end();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.filter((c) => c.command === "proc_write").map((c) => [decodeLenient(c.args as Uint8Array), c.headers!["close"]])).toEqual([
      ["one", "0"],
      ["two", "0"],
      ["", "1"],
    ]);
    channel!.onmessage(Uint8Array.from([0, ...encodeText("hello")]).buffer);
    const exitMessage = new ArrayBuffer(5);
    new DataView(exitMessage).setUint8(0, 2);
    new DataView(exitMessage).setInt32(1, 4, true);
    channel!.onmessage(exitMessage);
    expect(await exit).toBe(4);
    expect(output).toEqual(["hello"]);
  });

  it("reports processes that cannot start", async () => {
    const { run } = fakeInvoke(() => Promise.reject({ code: "EINVAL", message: "sh was not found." }));
    const child = tauriProcesses(run, () => ({ onmessage: () => undefined }) as unknown as Channel<ArrayBuffer>).spawn("sh", []);
    expect(await new Promise((resolve) => child.onExit((code, error) => resolve([code, error])))).toEqual([127, "sh was not found."]);
  });
});

describe("tauriTerminals", () => {
  const exitMessage = (code: number) => {
    const message = new ArrayBuffer(5);
    new DataView(message).setUint8(0, 2);
    new DataView(message).setInt32(1, code, true);
    return message;
  };

  it("opens a terminal, streams text split anywhere, and writes in order", async () => {
    let channel: { onmessage: (message: ArrayBuffer) => void } | undefined;
    const { run, calls } = fakeInvoke(async (call) => (call.command === "term_open" ? 4 : null));
    const terminals = tauriTerminals(run, () => (channel = { onmessage: () => undefined }) as unknown as Channel<ArrayBuffer>);
    const terminal = await terminals.open("ssh", ["-t", "host"], { cols: 80, rows: 24, env: { TERM: "xterm-256color" } });
    expect(calls[0]).toMatchObject({
      command: "term_open",
      args: { command: "ssh", args: ["-t", "host"], cwd: null, cols: 80, rows: 24, env: { TERM: "xterm-256color" } },
    });
    const output: string[] = [];
    const exit = new Promise<number>((resolve) => terminal.onExit(resolve));
    terminal.onData((data) => output.push(data));
    const umlaut = encodeText("ü");
    channel!.onmessage(Uint8Array.from([0, ...encodeText("gr"), umlaut[0]!]).buffer);
    channel!.onmessage(Uint8Array.from([0, umlaut[1]!, ...encodeText("n")]).buffer);
    channel!.onmessage(exitMessage(130));
    expect(await exit).toBe(130);
    expect(output.join("")).toBe("grün");

    terminal.write("a");
    terminal.write("b");
    terminal.resize(100, 30);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(calls.filter((c) => c.command === "term_write").map((c) => c.args)).toEqual([
      { id: 4, data: "a" },
      { id: 4, data: "b" },
    ]);
    expect(calls.find((c) => c.command === "term_resize")?.args).toEqual({ id: 4, cols: 100, rows: 30 });
  });

  it("keeps output and the exit that arrive before anyone listens", async () => {
    let channel: { onmessage: (message: ArrayBuffer) => void } | undefined;
    // The shell writes and ends before term_open has even replied.
    const { run } = fakeInvoke(async (call) => {
      if (call.command !== "term_open") return null;
      channel!.onmessage(Uint8Array.from([0, ...encodeText("\x1b[6n")]).buffer);
      channel!.onmessage(exitMessage(1));
      return 4;
    });
    const terminals = tauriTerminals(run, () => (channel = { onmessage: () => undefined }) as unknown as Channel<ArrayBuffer>);
    const terminal = await terminals.open("pwsh.exe", [], { cols: 80, rows: 24 });
    const output: string[] = [];
    terminal.onData((data) => output.push(data));
    const exit = await new Promise<number>((resolve) => terminal.onExit(resolve));
    expect(output).toEqual(["\x1b[6n"]);
    expect(exit).toBe(1);
  });

  it("asks Rust for the user's shell and rejects programs that cannot start", async () => {
    const { run } = fakeInvoke((call) =>
      call.command === "term_shell" ? "pwsh.exe" : Promise.reject({ code: "EINVAL", message: "GitDesk does not open terminals with git." }),
    );
    const terminals = tauriTerminals(run, () => ({ onmessage: () => undefined }) as unknown as Channel<ArrayBuffer>);
    expect(await terminals.shell()).toBe("pwsh.exe");
    await expect(terminals.open("git", [], { cols: 80, rows: 24 })).rejects.toThrow("GitDesk does not open terminals with git.");
  });
});
