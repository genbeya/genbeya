/**
 * The machine ports inside the Tauri webview, over the Rust commands in
 * src/shells/tauri/src-tauri/src (files.rs, processes.rs).
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import { FileSystemError, type ChildProcess, type FileStat, type FileSystem, type FileSystemErrorCode, type Machine, type ProcessRunner } from "../../access/ports";
import { encodeText } from "../../utilities/bytes";
import { posixPaths, windowsPaths } from "../../utilities/native-path";

const CODES = new Set<string>(["ENOENT", "EEXIST", "EPERM", "EACCES", "EBUSY", "ENOTDIR", "EISDIR", "ENOTEMPTY"]);
const DEFAULT_TIMEOUT = 60_000;
const STDOUT = 0;
const STDERR = 1;
const EXIT = 2;

type Invoke = typeof invoke;

/** Calls a command, turning its `{ code, message }` failures into FileSystemErrors. */
async function call<T>(run: Invoke, command: string, args?: Record<string, unknown> | Uint8Array, headers?: Record<string, string>): Promise<T> {
  try {
    return await run<T>(command, args, headers ? { headers } : undefined);
  } catch (failure) {
    const { code, message } = (failure ?? {}) as { code?: string; message?: string };
    throw new FileSystemError((code && CODES.has(code) ? code : "EIO") as FileSystemErrorCode, message ?? String(failure));
  }
}

export function tauriFileSystem(run: Invoke = invoke): FileSystem {
  return {
    lstat: (path) => call<FileStat>(run, "fs_stat", { path, follow: false }),
    stat: (path) => call<FileStat>(run, "fs_stat", { path, follow: true }),
    readFile: async (path) => new Uint8Array(await call<ArrayBuffer>(run, "fs_read", { path })),
    writeFile: (path, data, exclusive) => call(run, "fs_write", data, { path: encodeURIComponent(path), exclusive: exclusive ? "1" : "0" }),
    makeDirectory: (path) => call(run, "fs_mkdir", { path, recursive: true }),
    list: (path) => call<string[]>(run, "fs_readdir", { path }),
    rename: (from, to) => call(run, "fs_rename", { from, to }),
    removeFile: (path) => call(run, "fs_remove", { path, dir: false }),
    removeDirectory: (path) => call(run, "fs_remove", { path, dir: true }),
  };
}

export function tauriProcesses(run: Invoke = invoke, createChannel: () => Channel<ArrayBuffer> = () => new Channel<ArrayBuffer>()): ProcessRunner {
  return {
    async run(command, args, { cwd, timeout = DEFAULT_TIMEOUT, env = {} }) {
      // Reply: [code: i32][stderr length: u32][stderr][stdout], little-endian.
      const reply = await call<ArrayBuffer>(run, "proc_run", { command, args, cwd, env, timeoutMs: timeout });
      const view = new DataView(reply);
      const length = view.getUint32(4, true);
      return {
        code: view.getInt32(0, true),
        stderr: new TextDecoder().decode(new Uint8Array(reply, 8, length)),
        stdout: new Uint8Array(reply, 8 + length),
      };
    },

    spawn(command, args): ChildProcess {
      const listeners = { stdout: [] as ((chunk: Uint8Array) => void)[], stderr: [] as ((chunk: Uint8Array) => void)[], exit: [] as ((code: number, error?: string) => void)[] };
      let exited = false;
      const exit = (code: number, error?: string) => {
        if (exited) return;
        exited = true;
        for (const listener of listeners.exit) listener(code, error);
      };
      const events = createChannel();
      events.onmessage = (message) => {
        const bytes = new Uint8Array(message);
        if (bytes[0] === STDOUT) for (const listener of listeners.stdout) listener(bytes.slice(1));
        else if (bytes[0] === STDERR) for (const listener of listeners.stderr) listener(bytes.slice(1));
        else if (bytes[0] === EXIT) exit(new DataView(message).getInt32(1, true));
      };
      const id = call<number>(run, "proc_spawn", { command, args, events }).catch((error: Error) => {
        queueMicrotask(() => exit(127, error.message));
        return null;
      });
      // Writes are chained, so they reach the process in order.
      let writes: Promise<unknown> = id;
      const send = (data: Uint8Array, close: boolean) => {
        writes = writes.then(async () => {
          const process = await id;
          if (process !== null) await call(run, "proc_write", data, { id: String(process), close: close ? "1" : "0" }).catch(() => undefined);
        });
      };
      return {
        write: (data) => send(data, false),
        end: () => send(encodeText(""), true),
        kill: () => void id.then((process) => process !== null && !exited && call(run, "proc_kill", { id: process }).catch(() => undefined)),
        onStdout: (listener) => void listeners.stdout.push(listener),
        onStderr: (listener) => void listeners.stderr.push(listener),
        onExit: (listener) => void listeners.exit.push(listener),
      };
    },
  };
}

export function tauriMachine(): Machine {
  const agent = navigator.userAgent;
  const os = agent.includes("Windows") ? "windows" : agent.includes("Mac OS") ? "macos" : "linux";
  return { os, fileSystem: tauriFileSystem(), processes: tauriProcesses(), paths: os === "windows" ? windowsPaths : posixPaths };
}
