/** Pseudo-terminals on Node, through node-pty: the user's shell, for the app's terminal. */
import { execFile } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { delimiter, extname, join } from "node:path";
import type * as NodePty from "node-pty";
import type { TerminalRunner } from "../../access/ports";
import { startFailure, type Os } from "./node-machine";

/** How long a Windows terminal may take to end after its programs were ended. */
const KILL_FALLBACK = 3_000;

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
      const kill = () => {
        if (exited) return;
        if (os !== "windows") return child.kill();
        // node-pty's kill forks a helper that attaches to the console to list the programs in it.
        // The console closes meanwhile, so the helper fails and prints "AttachConsole failed" to
        // the app's stderr. Ending the shell's process tree ends the terminal as if the shell
        // exited; node-pty's kill is the fallback.
        execFile("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true }, () => undefined);
        setTimeout(() => exited || child.kill(), KILL_FALLBACK).unref();
      };
      return {
        write: (data) => void (exited || child.write(data)),
        resize: (columns, lines) => void (exited || child.resize(columns, lines)),
        kill,
        onData: (listener) => void child.onData(listener),
        onExit: (listener) => void child.onExit(({ exitCode }) => listener(exitCode)),
      };
    },
  };
}
