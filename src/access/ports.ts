/**
 * The runtime primitives the access layer needs from the machine GitDesk
 * runs on. src/platforms implements them for Node (Electron, Deno) and for
 * Tauri; nothing above this file knows which runtime it runs in.
 */
import type { PathStyle } from "../utilities/native-path";

export type FileSystemErrorCode = "ENOENT" | "EEXIST" | "EPERM" | "EACCES" | "EBUSY" | "ENOTDIR" | "EISDIR" | "ENOTEMPTY" | "EIO";

/** A file system failure with a Node-compatible code. */
export class FileSystemError extends Error {
  constructor(
    readonly code: FileSystemErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const hasCode = (error: unknown, ...codes: FileSystemErrorCode[]): boolean =>
  typeof error === "object" && error !== null && codes.includes((error as { code?: FileSystemErrorCode }).code!);

export interface FileStat {
  readonly kind: "file" | "dir" | "symlink" | "other";
  readonly size: number;
}

/** Native file system access with absolute paths. Failures throw {@link FileSystemError}. */
export interface FileSystem {
  /** Does not follow a final symbolic link (or Windows junction). */
  lstat(path: string): Promise<FileStat>;
  stat(path: string): Promise<FileStat>;
  readFile(path: string): Promise<Uint8Array>;
  /** `exclusive` fails with EEXIST when the file exists. */
  writeFile(path: string, data: Uint8Array, exclusive: boolean): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  list(path: string): Promise<string[]>;
  /** Moves a file or folder; replaces an existing file at `to` (preferences rely on this for atomic saves). */
  rename(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  removeDirectory(path: string): Promise<void>;
}

export interface RunOptions {
  readonly cwd: string;
  /** Milliseconds; the process is killed afterwards. 60 s unless given. */
  readonly timeout?: number;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * A finished process. A program that cannot start reports code 127 with an
 * explanation ("git was not found…" or "<cwd> does not exist.") in stderr.
 */
export interface RunResult {
  readonly code: number;
  readonly stdout: Uint8Array;
  readonly stderr: string;
}

/** A running process with piped standard streams. */
export interface ChildProcess {
  write(data: Uint8Array): void;
  /** Closes standard input. */
  end(): void;
  kill(): void;
  onStdout(listener: (chunk: Uint8Array) => void): void;
  onStderr(listener: (chunk: Uint8Array) => void): void;
  /** Called once, when the process ended or could not start (code 127). */
  onExit(listener: (code: number, error?: string) => void): void;
}

export interface ProcessRunner {
  run(command: string, args: readonly string[], options: RunOptions): Promise<RunResult>;
  spawn(command: string, args: readonly string[]): ChildProcess;
}

/** The machine GitDesk runs on. */
export interface Machine {
  readonly os: "windows" | "macos" | "linux";
  readonly fileSystem: FileSystem;
  readonly processes: ProcessRunner;
  /** Paths of the local file system. */
  readonly paths: PathStyle;
}
