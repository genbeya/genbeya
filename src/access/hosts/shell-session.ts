/**
 * One long-lived `sh` on another machine (through `wsl.exe` or `ssh`).
 * Requests run one at a time in a subshell; their output is staged in temp
 * files and returned with a length-prefixed header, so binary output is safe
 * and a single connection serves every operation.
 */
import { concatBytes, decodeLenient, encodeText } from "../../utilities/bytes";
import { SerialQueue } from "../../utilities/serial-queue";
import type { ChildProcess, ProcessRunner, RunResult } from "../ports";

export const DEFAULT_TIMEOUT = 60_000;
const CONNECT_TIMEOUT = 30_000;
/** How long a closing sh may take to finish and clean up before it is killed. */
const EXIT_GRACE = 3_000;
const READY = "GDK-READY";

/**
 * Defines `gd_check root relative`, which fails with 3 when a segment below
 * root is a link. The temp folder holds file contents, so it goes on every
 * exit: dash skips the EXIT trap when a signal ends it, hence the second trap.
 */
const BOOTSTRAP = `
T=$(mktemp -d 2>/dev/null || mktemp -d -t gitdesk) || exit 1
trap 'rm -rf "$T"' EXIT
trap 'exit 1' HUP INT TERM
export GIT_TERMINAL_PROMPT=0 GIT_OPTIONAL_LOCKS=0
gd_check() { ( set -f; c=$1; IFS=/; for s in $2; do c=$c/$s; if [ -L "$c" ]; then exit 3; fi; done ) }
printf '\\n${READY}\\n'
`;

/** Quotes a value for POSIX sh. */
export const quote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`;

export class ShellSession {
  private child: ChildProcess | null = null;
  private starting: Promise<void> | null = null;
  private buffer: Uint8Array = new Uint8Array();
  private wake: (() => void) | null = null;
  private diagnostics = "";
  private readonly queue = new SerialQueue();
  private disposed = false;

  constructor(
    private readonly processes: ProcessRunner,
    private readonly command: string,
    private readonly args: readonly string[],
    /** Names the machine in messages, e.g. "WSL (Ubuntu)". */
    readonly label: string,
  ) {}

  exec(script: string, timeout = DEFAULT_TIMEOUT): Promise<RunResult> {
    return this.queue.run(() => this.send(script, timeout));
  }

  /** Closes the session for good; later requests fail instead of reconnecting. */
  dispose() {
    this.disposed = true;
    this.reset();
  }

  /** Ends sh by closing its input, so it finishes the current request and cleans up; kills it if it does not. */
  private reset() {
    const child = this.child;
    this.child = null;
    if (!child) return;
    const timer = setTimeout(() => child.kill(), EXIT_GRACE);
    child.onExit(() => clearTimeout(timer));
    child.end();
  }

  private async send(script: string, timeout: number): Promise<RunResult> {
    if (this.disposed) throw new Error(`The connection to ${this.label} is closed.`);
    await this.connect();
    const deadline = Date.now() + timeout;
    this.child!.write(
      encodeText(
        `( ${script}\n) </dev/null >"$T/o" 2>"$T/e"; r=$?; ` +
          `printf 'GDK %s %s %s\\n' "$r" $(wc -c <"$T/o") $(wc -c <"$T/e"); cat "$T/o" "$T/e"\n`,
      ),
    );
    try {
      const header = /^GDK (\d+) (\d+) (\d+)$/.exec(await this.line(deadline));
      if (!header) throw new Error(`Unexpected reply from ${this.label}.`);
      const stdout = await this.take(Number(header[2]), deadline);
      const stderr = await this.take(Number(header[3]), deadline);
      return { code: Number(header[1]), stdout, stderr: decodeLenient(stderr) };
    } catch (error) {
      // The stream is out of step once a request fails; start over next time.
      this.reset();
      throw error;
    }
  }

  private connect(): Promise<void> {
    if (this.child) return Promise.resolve();
    this.starting ??= this.start().finally(() => (this.starting = null));
    return this.starting;
  }

  private async start() {
    this.buffer = new Uint8Array();
    this.diagnostics = "";
    const child = this.processes.spawn(this.command, this.args);
    this.child = child;
    // A reset sh may still write while it winds down; its output must not mix with the next one's.
    child.onStdout((chunk) => {
      if (this.child !== child) return;
      this.buffer = concatBytes([this.buffer, chunk]);
      this.wake?.();
    });
    child.onStderr((chunk) => {
      this.diagnostics = (this.diagnostics + decodeLenient(chunk)).slice(-4000);
    });
    child.onExit((_code, error) => {
      if (error) this.diagnostics ||= error;
      if (this.child === child) this.child = null;
      this.wake?.();
    });
    child.write(encodeText(BOOTSTRAP));
    const deadline = Date.now() + CONNECT_TIMEOUT;
    try {
      // Login scripts may print banners; skip everything before the marker.
      while ((await this.line(deadline, child)) !== READY);
    } catch (error) {
      if (this.child === child) this.reset();
      throw error;
    }
  }

  private async waitForData(deadline: number, child = this.child) {
    if (!child || child !== this.child)
      throw new Error(`Lost the connection to ${this.label}.` + (this.diagnostics.trim() ? ` ${this.diagnostics.trim()}` : ""));
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`${this.label} did not respond in time.`);
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, remaining);
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    this.wake = null;
  }

  private async line(deadline: number, child = this.child): Promise<string> {
    let end: number;
    while ((end = this.buffer.indexOf(10)) < 0) await this.waitForData(deadline, child);
    const text = decodeLenient(this.buffer.subarray(0, end)).replace(/\r$/, "");
    this.buffer = this.buffer.subarray(end + 1);
    return text;
  }

  private async take(length: number, deadline: number): Promise<Uint8Array> {
    while (this.buffer.length < length) await this.waitForData(deadline);
    const data = this.buffer.slice(0, length);
    this.buffer = this.buffer.subarray(length);
    return data;
  }
}
