/**
 * A host is the machine a repository lives on. Local folders, WSL
 * distributions and SSH servers share every line of repository logic through
 * this interface.
 *
 * File operations take a root plus a validated, slash-separated relative
 * path. Hosts refuse to traverse symbolic links below the root.
 */
import type { RunOptions, RunResult } from "../ports";
import type { PathStyle } from "../../utilities/native-path";
import type { TerminalCommand } from "./terminal-commands";

export type EntryKind = "file" | "dir" | null;

export interface Host {
  /** Paths on the host; POSIX for WSL and SSH even on Windows. */
  readonly paths: PathStyle;
  run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult>;
  read(root: string, relative: string, limit: number): Promise<Uint8Array>;
  /** Reads many files at once; missing, oversized or linked files map to null. */
  readMany(root: string, relatives: readonly string[], limit: number): Promise<(Uint8Array | null)[]>;
  write(root: string, relative: string, data: Uint8Array, exclusive: boolean): Promise<void>;
  kind(root: string, relative: string): Promise<EntryKind>;
  /** Removes a file; folders are refused. */
  remove(root: string, relative: string): Promise<void>;
  /** Moves a file or folder; fails when the target exists. */
  move(root: string, from: string, to: string): Promise<void>;
  /** Removes a folder if it is empty; false when it is not, or is no folder. */
  removeEmptyFolder(root: string, relative: string): Promise<boolean>;
  /** How to start the user's shell in `path` on this machine's pseudo-terminal. */
  terminalCommand(path: string): Promise<TerminalCommand>;
  dispose(): void;
}

export const TERMINALS_UNAVAILABLE = "The terminal is not available in this build.";

export type HostErrorCode = "ENOENT" | "SYMLINK" | "NOTFILE" | "TOOLARGE" | "EXISTS" | "FAILED";

const MESSAGES: Record<HostErrorCode, (relative: string) => string> = {
  ENOENT: (r) => `${r} does not exist.`,
  SYMLINK: (r) => `${r} is behind a symbolic link, which GitDesk does not follow.`,
  NOTFILE: (r) => `${r} is not a regular file.`,
  TOOLARGE: (r) => `${r} is too large to open.`,
  EXISTS: (r) => `${r} already exists.`,
  FAILED: (r) => `Could not access ${r}.`,
};

export class HostError extends Error {
  constructor(
    readonly code: HostErrorCode,
    readonly relative: string,
    detail?: string,
  ) {
    super(detail ?? MESSAGES[code](relative));
  }
}

export const isMissing = (error: unknown): boolean => error instanceof HostError && error.code === "ENOENT";

export const isTooLarge = (error: unknown): boolean => error instanceof HostError && error.code === "TOOLARGE";

/**
 * Environment for every git call: never prompt, never take optional locks,
 * never open an editor (":" tells git to keep the message it prepared).
 */
export const GIT_ENVIRONMENT: Readonly<Record<string, string>> = {
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  GCM_INTERACTIVE: "never",
  GIT_EDITOR: ":",
};
