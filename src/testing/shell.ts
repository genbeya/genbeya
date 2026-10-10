/** A POSIX sh for tests of the shell transport. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/** /bin/sh, or Git for Windows' sh.exe; null when neither exists. */
export function findShell(windows: boolean): string | null {
  if (!windows) return "sh";
  try {
    const execPath = execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    const sh = path.resolve(execPath, "../../../usr/bin/sh.exe");
    return existsSync(sh) ? sh : null;
  } catch {
    return null;
  }
}
