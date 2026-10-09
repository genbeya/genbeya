import type { Channel } from "@tauri-apps/api/core";
import { describe, expect, it } from "vitest";
import { FileSystemError } from "../../access/ports";
import { decodeLenient, encodeText } from "../../utilities/bytes";
import { tauriFileSystem, tauriProcesses } from "./tauri-machine";

interface Call { command: string; args: unknown; headers?: Record<string, string> }

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
    const failure = await tauriFileSystem(run).stat("x").catch((error: unknown) => error);
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
    expect({ code: result.code, stdout: decodeLenient(result.stdout), stderr: result.stderr }).toEqual({ code: 3, stdout: "out", stderr: "err" });
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
