/** Shells in the open repository, on the repository's machine. */
import type { TerminalManagerContract } from "../contracts/manager-contracts";
import type { TerminalOutput } from "../contracts/model";
import { TERMINALS_UNAVAILABLE } from "../access/hosts/host";
import type { TerminalRunner } from "../access/ports";
import { TerminalSession, type TerminalSize } from "../access/terminals/terminal-session";
import type { WorkspaceRegistry } from "./workspace";

const MAX_COLUMNS = 1000;
const MAX_ROWS = 500;
/** A large paste; larger input is refused rather than flooding the shell. */
const INPUT_LIMIT = 1_000_000;
const CLOSED = "This terminal is closed.";

interface OpenTerminal {
  readonly session: TerminalSession;
  /** Stops listening for the repository closing. */
  readonly release: () => void;
}

function size(cols: unknown, rows: unknown): TerminalSize {
  const within = (value: unknown, max: number) => Number.isInteger(value) && (value as number) >= 1 && (value as number) <= max;
  if (!within(cols, MAX_COLUMNS) || !within(rows, MAX_ROWS)) throw new Error("Invalid terminal size.");
  return { cols: cols as number, rows: rows as number };
}

export class TerminalManager implements TerminalManagerContract {
  private readonly terminals = new Map<string, OpenTerminal>();

  constructor(
    private readonly registry: WorkspaceRegistry,
    /** Null where the runtime has no pseudo-terminals. */
    private readonly runner: TerminalRunner | null,
  ) {}

  async available(): Promise<boolean> {
    return this.runner !== null;
  }

  async open(id: unknown, cols: unknown, rows: unknown): Promise<string> {
    const workspace = this.registry.get(id);
    const dimensions = size(cols, rows);
    if (!this.runner) throw new Error(TERMINALS_UNAVAILABLE);
    const session = await TerminalSession.open(this.runner, workspace.host, workspace.repository.root, dimensions);
    const terminal = crypto.randomUUID();
    this.terminals.set(terminal, { session, release: workspace.onClose(() => this.end(terminal)) });
    // The repository may have closed while the shell started; then it ended with it.
    if (!this.terminals.has(terminal)) throw new Error("This repository is no longer open.");
    return terminal;
  }

  async write(terminal: unknown, data: unknown): Promise<void> {
    const { session } = this.get(terminal);
    if (typeof data !== "string" || data.length > INPUT_LIMIT) throw new Error("Invalid terminal input.");
    session.write(data);
  }

  async resize(terminal: unknown, cols: unknown, rows: unknown): Promise<void> {
    const { session } = this.get(terminal);
    const dimensions = size(cols, rows);
    session.resize(dimensions.cols, dimensions.rows);
  }

  async read(terminal: unknown): Promise<TerminalOutput> {
    return this.get(terminal).session.read();
  }

  async close(terminal: unknown): Promise<void> {
    if (typeof terminal !== "string") return;
    this.terminals.get(terminal)?.release();
    this.end(terminal);
  }

  private get(terminal: unknown): OpenTerminal {
    const open = typeof terminal === "string" ? this.terminals.get(terminal) : undefined;
    if (!open) throw new Error(CLOSED);
    return open;
  }

  private end(terminal: string) {
    this.terminals.get(terminal)?.session.close();
    this.terminals.delete(terminal);
  }
}
