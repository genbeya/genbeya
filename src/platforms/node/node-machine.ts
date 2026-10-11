/** The machine ports on Node and Deno (through its Node compatibility). */
import { execFile, spawn } from "node:child_process";
import { existsSync, lstatSync, promises as fs, type Stats } from "node:fs";
import { platform } from "node:os";
import { delimiter, extname, join } from "node:path";
import type * as NodePty from "node-pty";
import type {
  ChildProcess,
  FileStat,
  FileSystem,
  FileSystemErrorCode,
  Machine,
  ProcessRunner,
  RunOptions,
  RunResult,
  TerminalRunner,
} from "../../access/ports";
import { FileSystemError, TIMED_OUT, TOO_MUCH_OUTPUT } from "../../access/ports";
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
          if (failure?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
            return resolve({ code: TOO_MUCH_OUTPUT, stdout: new Uint8Array(), stderr: `${command} wrote more output than GitDesk reads.` });
          resolve({
            code: !failure ? 0 : typeof failure.code === "number" ? failure.code : failure.killed ? TIMED_OUT : 1,
            stdout: new Uint8Array(stdout),
            // A plain exit code needs no explanation of Node's: "Command failed: …" only repeats the command.
            stderr:
              stderrText || (failure?.killed ? `${command} timed out.` : typeof failure?.code === "number" ? "" : (failure?.message ?? "")),
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

type Os = Machine["os"];

/** The user's shell, as the port describes it; `found` tells whether a program is on PATH. */
export function defaultShell(os: Os, env: Readonly<Record<string, string | undefined>>, found: (program: string) => boolean): string {
  if (os !== "windows") return env["SHELL"] || "/bin/sh";
  return ["pwsh.exe", "powershell.exe"].find(found) ?? env["COMSPEC"] ?? "powershell.exe";
}

/** True for paths that exist, including Windows app execution aliases (WindowsApps\pwsh.exe), which only lstat can see. */
const exists = (file: string) => {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * The program `command` names: a path, or a program on PATH. node-pty finds
 * Windows programs only by their full name, so ".exe" is added there.
 */
function locate(os: Os, command: string): string | null {
  const file = os === "windows" && !extname(command) ? `${command}.exe` : command;
  if (file.includes("/") || file.includes("\\")) return exists(file) ? file : null;
  const folders = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  return folders.some((folder) => exists(join(folder, file))) ? file : null;
}

/** node-pty, loaded on first use: a native module, so a build may lack it. */
let ptyModule: Promise<typeof NodePty> | undefined;

export function nodeTerminals(os: Os): TerminalRunner {
  return {
    async shell() {
      return defaultShell(os, process.env, (program) => locate(os, program) !== null);
    },

    async open(command, args, { cwd = process.cwd(), cols, rows, env }) {
      const file = locate(os, command);
      if (!file || !existsSync(cwd)) throw new Error(startFailure(command, cwd));
      const pty = await (ptyModule ??= import("node-pty"));
      const child = pty.spawn(file, [...args], { name: "xterm-256color", cwd, cols, rows, env: { ...process.env, ...env } });
      // node-pty throws when an ended terminal is written to or resized.
      let exited = false;
      child.onExit(() => (exited = true));
      return {
        write: (data) => void (exited || child.write(data)),
        resize: (columns, lines) => void (exited || child.resize(columns, lines)),
        kill: () => void (exited || child.kill()),
        onData: (listener) => void child.onData(listener),
        onExit: (listener) => void child.onExit(({ exitCode }) => listener(exitCode)),
      };
    },
  };
}

export function nodeMachine(): Machine {
  const os = platform() === "win32" ? "windows" : platform() === "darwin" ? "macos" : "linux";
  return {
    os,
    fileSystem: nodeFileSystem,
    processes: nodeProcesses,
    terminals: nodeTerminals(os),
    paths: os === "windows" ? windowsPaths : posixPaths,
  };
}
