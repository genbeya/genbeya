/**
 * The terminal panel of the open repository: whether it shows, its tabs, and
 * the stream between each tab's view and its shell in the backend.
 */
import { Injectable, inject, signal } from "@angular/core";
import type { TerminalManagerContract } from "../../../contracts/manager-contracts";
import { MANAGERS } from "../platform/platform";
import { messageOf } from "./notifications";
import { Session } from "./session";

/** Shows and hides the panel, from anywhere, the terminal included. */
export const TOGGLE_TERMINAL = "mod+`";
/** Input is sent in pieces of this size, so a large paste stays within what the manager accepts. */
const WRITE_CHUNK = 64 * 1024;

export interface TerminalTab {
  readonly key: number;
  readonly title: string;
}

/** Where a tab's output goes: the view showing it. */
export interface TerminalScreen {
  write(data: string): void;
  /** The shell has ended or could not start; `note` says why. */
  end(note: string): void;
}

/** One tab's shell: a loop of reads, and input sent in order without a round trip per keystroke. */
class Connection {
  private pending = "";
  private sending = false;
  private closed = false;

  constructor(
    private readonly terminal: TerminalManagerContract,
    private readonly id: string,
  ) {}

  /** Copies output to `screen` until the shell ends; resolves to its exit code, or null when it was closed or failed. */
  async pump(screen: TerminalScreen): Promise<number | null> {
    try {
      while (!this.closed) {
        const output = await this.terminal.read(this.id);
        if (this.closed) break;
        if ("exit" in output) return output.exit;
        if (output.data) screen.write(output.data);
      }
    } catch (error) {
      if (!this.closed) screen.end(messageOf(error));
    }
    return null;
  }

  write(data: string): void {
    this.pending += data;
    if (!this.sending) void this.send();
  }

  resize(cols: number, rows: number): void {
    if (!this.closed) this.terminal.resize(this.id, cols, rows).catch(() => undefined);
  }

  close(): void {
    this.closed = true;
    this.terminal.close(this.id).catch(() => undefined);
  }

  private async send() {
    this.sending = true;
    while (this.pending && !this.closed) {
      let end = Math.min(this.pending.length, WRITE_CHUNK);
      // Never split a character made of two UTF-16 units.
      if (end < this.pending.length && /[\ud800-\udbff]/.test(this.pending[end - 1]!)) end--;
      const data = this.pending.slice(0, end);
      this.pending = this.pending.slice(end);
      // A shell that ended refuses input; its view reports the end.
      await this.terminal.write(this.id, data).catch(() => undefined);
    }
    this.sending = false;
  }
}

@Injectable({ providedIn: "root" })
export class Terminals {
  private readonly terminal = inject(MANAGERS).terminal;
  private readonly session = inject(Session);
  private readonly connections = new Map<number, Connection>();
  private next = 1;

  readonly shown = signal(false);
  readonly tabs = signal<readonly TerminalTab[]>([]);
  readonly active = signal<number | null>(null);
  /** Whether this build has terminals; null until the panel first opens. */
  readonly available = signal<boolean | null>(null);

  async toggle(): Promise<void> {
    if (this.shown()) this.shown.set(false);
    else await this.show();
  }

  /** Shows the panel, with a first terminal if there is none. */
  async show(): Promise<void> {
    if (this.available() === null) this.available.set(await this.terminal.available().catch(() => false));
    if (this.available() && !this.tabs().length) this.add();
    this.shown.set(true);
  }

  add(): void {
    const key = this.next++;
    this.tabs.update((tabs) => [...tabs, { key, title: `Terminal ${key}` }]);
    this.active.set(key);
  }

  select(key: number): void {
    this.active.set(key);
  }

  /** Ends a tab's shell and removes the tab; the panel hides with the last one. */
  close(key: number): void {
    this.connections.get(key)?.close();
    this.connections.delete(key);
    const tabs = this.tabs();
    const index = tabs.findIndex((tab) => tab.key === key);
    const rest = tabs.filter((tab) => tab.key !== key);
    this.tabs.set(rest);
    if (this.active() === key) this.active.set(rest[Math.min(index, rest.length - 1)]?.key ?? null);
    if (!rest.length) this.shown.set(false);
  }

  /** Ends every shell; the repository is closing. */
  closeAll(): void {
    for (const tab of this.tabs()) this.close(tab.key);
    this.next = 1;
  }

  /** Starts the shell of tab `key` at the view's size; its output goes to `screen` until it ends. */
  async connect(key: number, cols: number, rows: number, screen: TerminalScreen): Promise<void> {
    let id: string;
    try {
      id = await this.terminal.open(this.session.id()!, cols, rows);
    } catch (error) {
      screen.end(messageOf(error));
      return;
    }
    const connection = new Connection(this.terminal, id);
    // The tab may have closed while the shell started.
    if (!this.tabs().some((tab) => tab.key === key)) return connection.close();
    this.connections.set(key, connection);
    void connection.pump(screen).then((exit) => {
      // Like other terminals, a shell left with `exit` takes its tab along; other ends stay readable.
      if (exit === 0) this.close(key);
      else if (exit !== null) screen.end(`The shell exited with code ${exit}.`);
    });
  }

  write(key: number, data: string): void {
    this.connections.get(key)?.write(data);
  }

  resize(key: number, cols: number, rows: number): void {
    this.connections.get(key)?.resize(cols, rows);
  }
}
