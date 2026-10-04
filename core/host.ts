/**
 * A host is the machine a repository lives on. The engine only talks to it
 * through this interface, so local folders, WSL distributions and SSH servers
 * share every line of repository logic.
 *
 * File operations take a root plus a validated, slash-separated relative path.
 * Hosts refuse to traverse symbolic links below the root.
 */

export interface RunOptions {
  cwd: string;
  timeout?: number;
}

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

export type EntryKind = "file" | "dir" | null;

export interface Host {
  /** True when paths on this host use `/` and POSIX semantics. */
  readonly posix: boolean;
  join(root: string, relative: string): string;
  run(command: string, args: string[], options: RunOptions): Promise<RunResult>;
  read(root: string, relative: string, limit: number): Promise<Buffer>;
  /** Reads many files at once; missing, oversized or linked files map to null. */
  readMany(
    root: string,
    relatives: string[],
    limit: number,
  ): Promise<(Buffer | null)[]>;
  write(
    root: string,
    relative: string,
    data: Buffer,
    exclusive: boolean,
  ): Promise<void>;
  kind(root: string, relative: string): Promise<EntryKind>;
  remove(root: string, relative: string): Promise<void>;
  move(root: string, from: string, to: string): Promise<void>;
  dispose(): void;
}

export type HostErrorCode =
  | "ENOENT"
  | "SYMLINK"
  | "NOTFILE"
  | "TOOLARGE"
  | "EXISTS"
  | "FAILED";

export class HostError extends Error {
  constructor(
    readonly code: HostErrorCode,
    readonly relative: string,
    detail?: string,
  ) {
    super(
      detail ??
        {
          ENOENT: `${relative} does not exist.`,
          SYMLINK: `${relative} is behind a symbolic link, which GitDesk does not follow.`,
          NOTFILE: `${relative} is not a regular file.`,
          TOOLARGE: `${relative} is too large to open.`,
          EXISTS: `${relative} already exists.`,
          FAILED: `Could not access ${relative}.`,
        }[code],
    );
  }
}

export const isMissing = (error: unknown) =>
  error instanceof HostError && error.code === "ENOENT";
