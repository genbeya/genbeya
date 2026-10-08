/**
 * node:child_process's execFile and spawn over Tauri commands
 * (desktop/tauri/src-tauri/src/process.rs), as far as the engine uses them:
 * buffered runs for git, and long-lived processes with piped stdio for the
 * WSL/SSH shell sessions and PlantUML.
 */
import { Channel } from "@tauri-apps/api/core";
import { call } from "./fs";

type Callback = (error: { code: number; message: string } | null, stdout: Buffer, stderr: Buffer) => void;

interface ExecOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string | undefined>;
}

export function execFile(command: string, args: string[], options: ExecOptions, callback: Callback) {
  const env = Object.fromEntries(Object.entries(options.env ?? {}).filter(([, v]) => typeof v === "string"));
  call<ArrayBuffer>("proc_run", { command, args, cwd: options.cwd ?? null, env, timeoutMs: options.timeout ?? 0 }).then(
    (reply) => {
      // [code: i32][stderr length: u32][stderr][stdout]
      const view = new DataView(reply);
      const code = view.getInt32(0, true);
      const length = view.getUint32(4, true);
      const stderr = Buffer.from(reply, 8, length);
      const stdout = Buffer.from(reply, 8 + length);
      callback(code === 0 ? null : { code, message: stderr.toString("utf8") }, stdout, stderr);
    },
    (error: Error) => callback({ code: 127, message: error.message }, Buffer.alloc(0), Buffer.from(error.message)),
  );
}

class Emitter {
  private listeners = new Map<string, ((...args: any[]) => void)[]>();
  on(event: string, listener: (...args: any[]) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }
  emit(event: string, ...args: unknown[]) {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

const STDOUT = 0, STDERR = 1, EXIT = 2;

class ChildProcess extends Emitter {
  readonly stdout = new Emitter();
  readonly stderr = new Emitter();
  readonly stdin: Emitter & { write(data: string | Uint8Array): boolean; end(data?: string | Uint8Array): void };
  private id: Promise<number | null>;
  private exited = false;

  constructor(command: string, args: string[]) {
    super();
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (message) => {
      const bytes = new Uint8Array(message);
      if (bytes[0] === STDOUT) this.stdout.emit("data", Buffer.from(bytes.subarray(1)));
      else if (bytes[0] === STDERR) this.stderr.emit("data", Buffer.from(bytes.subarray(1)));
      else if (bytes[0] === EXIT && !this.exited) {
        this.exited = true;
        const code = new DataView(message).getInt32(1, true);
        this.emit("exit", code);
        this.emit("close", code);
      }
    };
    this.id = call<number>("proc_spawn", { command, args, events: channel }).catch((error: Error) => {
      queueMicrotask(() => this.emit("error", error));
      return null;
    });
    // Writes are chained so they reach the process in order.
    let writes: Promise<unknown> = this.id;
    const send = (data: string | Uint8Array | undefined, close: boolean) => {
      writes = writes.then(async () => {
        const id = await this.id;
        if (id === null) return;
        const bytes = typeof data === "string" ? Buffer.from(data, "utf8") : (data ?? new Uint8Array());
        await call("proc_write", bytes, { id: String(id), close: close ? "1" : "0" }).catch((error) =>
          this.stdin.emit("error", error),
        );
      });
    };
    const stdin = new Emitter() as ChildProcess["stdin"];
    stdin.write = (data) => (send(data, false), true);
    stdin.end = (data) => send(data, true);
    this.stdin = stdin;
  }

  kill() {
    void this.id.then((id) => id !== null && !this.exited && call("proc_kill", { id }).catch(() => undefined));
    return true;
  }
}

export function spawn(command: string, args: string[], options: { shell?: boolean } = {}) {
  // Windows needs a shell to run .bat/.cmd launchers such as plantuml.
  if (options.shell && navigator.userAgent.includes("Windows"))
    return new ChildProcess("cmd.exe", ["/d", "/s", "/c", command, ...args]);
  return new ChildProcess(command, args);
}

export type ChildProcessWithoutNullStreams = ChildProcess;
