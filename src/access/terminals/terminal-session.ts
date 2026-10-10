/**
 * A shell on this machine's pseudo-terminal, started by a repository's host.
 * Shells talk to the client by request and reply only, so output waits here
 * until the client reads it: a read returns as soon as there is output, which
 * makes a loop of reads a stream over any bridge.
 */
import type { TerminalOutput } from "../../contracts/model";
import type { Host } from "../hosts/host";
import type { Terminal, TerminalRunner } from "../ports";

/** Output kept for a client that stopped reading; older output is dropped. */
const OUTPUT_LIMIT = 1_000_000;
/** How long a read waits for output; bridges should not hold calls open for ever. */
export const READ_WAIT = 25_000;
const ENVIRONMENT = { TERM: "xterm-256color", COLORTERM: "truecolor" };

export interface TerminalSize {
  readonly cols: number;
  readonly rows: number;
}

export class TerminalSession {
  private chunks: string[] = [];
  private length = 0;
  private exitCode: number | null = null;
  private closed = false;
  private readonly waiting = new Set<() => void>();

  private constructor(private readonly terminal: Terminal) {
    terminal.onData((data) => {
      this.chunks.push(data);
      this.length += data.length;
      while (this.length > OUTPUT_LIMIT && this.chunks.length > 1) this.length -= this.chunks.shift()!.length;
      this.wake();
    });
    terminal.onExit((code) => {
      this.exitCode = code;
      this.wake();
    });
  }

  /** Starts the shell `host` runs for the repository at `path`. */
  static async open(runner: TerminalRunner, host: Host, path: string, { cols, rows }: TerminalSize): Promise<TerminalSession> {
    const { command, args, cwd } = await host.terminalCommand(path);
    return new TerminalSession(await runner.open(command, args, { ...(cwd ? { cwd } : {}), cols, rows, env: ENVIRONMENT }));
  }

  write(data: string): void {
    this.terminal.write(data);
  }

  resize(cols: number, rows: number): void {
    this.terminal.resize(cols, rows);
  }

  /** The output since the last read; waits up to `wait` ms for some. The exit comes after the last output. */
  async read(wait = READ_WAIT): Promise<TerminalOutput> {
    if (!this.chunks.length && this.exitCode === null && !this.closed) await this.next(wait);
    if (this.chunks.length) {
      const data = this.chunks.join("").slice(-OUTPUT_LIMIT);
      this.chunks = [];
      this.length = 0;
      return { data };
    }
    return this.exitCode === null ? { data: "" } : { exit: this.exitCode };
  }

  /** Ends the shell; a pending read returns. */
  close(): void {
    this.closed = true;
    this.terminal.kill();
    this.wake();
  }

  private next(wait: number): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.waiting.delete(done);
        resolve();
      };
      const timer = setTimeout(done, wait);
      this.waiting.add(done);
    });
  }

  private wake() {
    for (const done of [...this.waiting]) done();
  }
}
