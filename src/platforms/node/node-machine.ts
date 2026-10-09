/** The machine ports on Node and Deno (through its Node compatibility). */
import { execFile, spawn } from "node:child_process";
import { existsSync, promises as fs, type Stats } from "node:fs";
import { platform } from "node:os";
import type { ChildProcess, FileStat, FileSystem, FileSystemErrorCode, Machine, ProcessRunner, RunOptions, RunResult } from "../../access/ports";
import { FileSystemError } from "../../access/ports";
import { posixPaths, windowsPaths } from "../../utilities/native-path";

const KNOWN_CODES = new Set<string>(["ENOENT", "EEXIST", "EPERM", "EACCES", "EBUSY", "ENOTDIR", "EISDIR", "ENOTEMPTY"]);
const DEFAULT_TIMEOUT = 60_000;
const OUTPUT_LIMIT = 64 * 1024 * 1024;

async function translate<T>(operation: Promise<T>): Promise<T> {
  try {
    return await operation;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code ?? "";
    throw new FileSystemError((KNOWN_CODES.has(code) ? code : "EIO") as FileSystemErrorCode, (error as Error).message);
  }
}

const statOf = (stats: Stats): FileStat => ({
  kind: stats.isSymbolicLink() ? "symlink" : stats.isDirectory() ? "dir" : stats.isFile() ? "file" : "other",
  size: stats.size,
});

export const nodeFileSystem: FileSystem = {
  lstat: async (path) => statOf(await translate(fs.lstat(path))),
  stat: async (path) => statOf(await translate(fs.stat(path))),
  readFile: async (path) => new Uint8Array(await translate(fs.readFile(path))),
  writeFile: (path, data, exclusive) => translate(fs.writeFile(path, data, { flag: exclusive ? "wx" : "w" })),
  makeDirectory: async (path) => void (await translate(fs.mkdir(path, { recursive: true }))),
  list: (path) => translate(fs.readdir(path)),
  rename: (from, to) => translate(fs.rename(from, to)),
  removeFile: (path) => translate(fs.unlink(path)),
  removeDirectory: (path) => translate(fs.rmdir(path)),
};

/** Explains a program that could not start, as the port promises. */
const startFailure = (command: string, cwd: string) =>
  existsSync(cwd) ? `${command} was not found. Install it and add it to PATH.` : `${cwd} does not exist.`;

export const nodeProcesses: ProcessRunner = {
  run(command, args, { cwd, timeout = DEFAULT_TIMEOUT, env }: RunOptions) {
    return new Promise<RunResult>((resolve) => {
      execFile(
        command,
        [...args],
        { cwd, timeout, encoding: "buffer", maxBuffer: OUTPUT_LIMIT, windowsHide: true, env: { ...process.env, ...env } },
        (error, stdout, stderr) => {
          const failure = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
          const stderrText = stderr.toString("utf8");
          if (failure?.code === "ENOENT") return resolve({ code: 127, stdout: new Uint8Array(), stderr: startFailure(command, cwd) });
          resolve({
            code: !failure ? 0 : typeof failure.code === "number" ? failure.code : failure.killed ? 124 : 1,
            stdout: new Uint8Array(stdout),
            stderr: stderrText || (failure?.killed ? `${command} timed out.` : (failure?.message ?? "")),
          });
        },
      );
    });
  },

  spawn(command, args): ChildProcess {
    const child = spawn(command, [...args], { windowsHide: true });
    let exited = false;
    const exitListeners: ((code: number, error?: string) => void)[] = [];
    const exit = (code: number, error?: string) => {
      if (exited) return;
      exited = true;
      for (const listener of exitListeners) listener(code, error);
    };
    child.on("exit", (code) => exit(code ?? 1));
    child.on("error", (error) => exit(127, error.message));
    child.stdin.on("error", () => undefined);
    return {
      write: (data) => void child.stdin.write(data),
      end: () => child.stdin.end(),
      kill: () => void child.kill(),
      onStdout: (listener) => void child.stdout.on("data", (chunk: Buffer) => listener(new Uint8Array(chunk))),
      onStderr: (listener) => void child.stderr.on("data", (chunk: Buffer) => listener(new Uint8Array(chunk))),
      onExit: (listener) => void exitListeners.push(listener),
    };
  },
};

export function nodeMachine(): Machine {
  const os = platform() === "win32" ? "windows" : platform() === "darwin" ? "macos" : "linux";
  return { os, fileSystem: nodeFileSystem, processes: nodeProcesses, paths: os === "windows" ? windowsPaths : posixPaths };
}
