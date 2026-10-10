/**
 * The machine ports inside the Tauri webview, over the Rust commands in
 * src/shells/tauri/src-tauri/src (files.rs, processes.rs, terminals.rs).
 */
import { Channel, invoke } from "@tauri-apps/api/core";
import {
  FileSystemError,
  type ChildProcess,
  type FileStat,
  type FileSystem,
  type FileSystemErrorCode,
  type Machine,
  type ProcessRunner,
  type TerminalRunner,
} from "../../access/ports";
import { encodeText } from "../../utilities/bytes";
import { posixPaths, windowsPaths } from "../../utilities/native-path";

const CODES = new Set<string>(["ENOENT", "EEXIST", "EPERM", "EACCES", "EBUSY", "ENOTDIR", "EISDIR", "ENOTEMPTY"]);
const DEFAULT_TIMEOUT = 60_000;
const STDOUT = 0;
const STDERR = 1;
const EXIT = 2;

type Invoke = typeof invoke;

/** Calls a command, turning its `{ code, message }` failures into FileSystemErrors. */
async function call<T>(
  run: Invoke,
  command: string,
  args?: Record<string, unknown> | Uint8Array,
  headers?: Record<string, string>,
): Promise<T> {
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

export function tauriProcesses(
  run: Invoke = invoke,
  createChannel: () => Channel<ArrayBuffer> = () => new Channel<ArrayBuffer>(),
): ProcessRunner {
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
      const listeners = {
        stdout: [] as ((chunk: Uint8Array) => void)[],
        stderr: [] as ((chunk: Uint8Array) => void)[],
        exit: [] as ((code: number, error?: string) => void)[],
      };
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
          if (process !== null)
            await call(run, "proc_write", data, { id: String(process), close: close ? "1" : "0" }).catch(() => undefined);
        });
      };
      return {
        write: (data) => send(data, false),
        end: () => send(encodeText(""), true),
        kill: () =>
          void id.then((process) => process !== null && !exited && call(run, "proc_kill", { id: process }).catch(() => undefined)),
        onStdout: (listener) => void listeners.stdout.push(listener),
        onStderr: (listener) => void listeners.stderr.push(listener),
        onExit: (listener) => void listeners.exit.push(listener),
      };
    },
  };
}

export function tauriTerminals(
  run: Invoke = invoke,
  createChannel: () => Channel<ArrayBuffer> = () => new Channel<ArrayBuffer>(),
): TerminalRunner {
  return {
    shell: () => call<string>(run, "term_shell"),

    async open(command, args, { cwd, cols, rows, env = {} }) {
      const listeners = { data: [] as ((data: string) => void)[], exit: [] as ((code: number) => void)[] };
      // Output arrives as bytes; a character may be split between two messages.
      const decoder = new TextDecoder();
      // The shell starts before term_open replies, so before anyone listens (ConPTY's first
      // message is a question xterm.js must answer): output waits for the first data listener,
      // and the exit is told to exit listeners that come later.
      let early: string[] | null = [];
      let exitCode: number | null = null;
      const events = createChannel();
      events.onmessage = (message) => {
        const bytes = new Uint8Array(message);
        if (bytes[0] === STDOUT) {
          const data = decoder.decode(bytes.subarray(1), { stream: true });
          if (early) early.push(data);
          else for (const listener of listeners.data) listener(data);
        } else if (bytes[0] === EXIT) {
          exitCode = new DataView(message).getInt32(1, true);
          for (const listener of listeners.exit) listener(exitCode);
        }
      };
      const id = await call<number>(run, "term_open", { command, args, cwd: cwd ?? null, cols, rows, env, events });
      // A terminal that ended meanwhile refuses; there is nothing to report then.
      const request = (name: string, values: Record<string, unknown>) => call(run, name, { id, ...values }).catch(() => undefined);
      // Writes are chained, so they reach the shell in order.
      let writes: Promise<unknown> = Promise.resolve();
      return {
        write: (data) => void (writes = writes.then(() => request("term_write", { data }))),
        resize: (columns, lines) => void request("term_resize", { cols: columns, rows: lines }),
        kill: () => void (exitCode !== null || request("term_kill", {})),
        onData(listener) {
          listeners.data.push(listener);
          const output = early;
          early = null;
          for (const data of output ?? []) listener(data);
        },
        onExit(listener) {
          listeners.exit.push(listener);
          if (exitCode !== null) listener(exitCode);
        },
      };
    },
  };
}

export function tauriMachine(): Machine {
  const agent = navigator.userAgent;
  const os = agent.includes("Windows") ? "windows" : agent.includes("Mac OS") ? "macos" : "linux";
  return {
    os,
    fileSystem: tauriFileSystem(),
    processes: tauriProcesses(),
    terminals: tauriTerminals(),
    paths: os === "windows" ? windowsPaths : posixPaths,
  };
}
