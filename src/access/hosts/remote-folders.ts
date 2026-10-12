/**
 * Lists folders on WSL distributions and SSH servers, so a path there can be
 * chosen instead of typed. The shell session of the machine last browsed is
 * kept between listings; it closes when another machine is browsed, or idle.
 */
import type { Folder, FolderListing, RemoteLocation } from "../../contracts/model";
import { decodeLenient } from "../../utilities/bytes";
import { posixPaths } from "../../utilities/native-path";
import type { HostFactory } from "./host-factory";
import { ConnectionError, quote, type ShellSession } from "./shell-session";

const MAX_FOLDERS = 2000;
const IDLE_TIMEOUT = 60_000;
const LIST_TIMEOUT = 30_000;

/**
 * Takes `home relative limit`: enters the home folder when `home` is 1, then
 * `relative` (absolute when `home` is 0). Prints the resolved folder, then a
 * record per subfolder, "r" for a Git repository (it holds .git) or "d"
 * followed by its name, and "+" when the limit cut the list. Records end with
 * NUL, so any name survives. `[ -d ]` follows links: linked folders count.
 */
const LIST = `unset CDPATH
if [ "$1" = 1 ]; then cd || exit 4; fi
if [ -n "$2" ]; then [ -e "$2" ] || exit 4; [ -d "$2" ] || exit 5; cd -- "$2" || exit 6; fi
p=$(pwd -P) || exit 1
printf '%s\\000' "$p"
n=0
for d in * .*; do
  case $d in .|..) continue ;; esac
  [ -d "$d" ] || continue
  n=$((n + 1))
  if [ $n -gt "$3" ]; then printf '+\\000'; break; fi
  if [ -e "$d/.git" ]; then printf 'r%s\\000' "$d"; else printf 'd%s\\000' "$d"; fi
done`;

/** Exit codes of {@link LIST}. */
const FAILURES: Partial<Record<number, string>> = { 4: "does not exist.", 5: "is not a folder.", 6: "cannot be opened." };

const isHome = (path: string) => path === "" || path === "~" || path.startsWith("~/");

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const hidden = (folder: Folder) => (folder.name.startsWith(".") ? 1 : 0);
const byName = (a: Folder, b: Folder) =>
  hidden(a) - hidden(b) || compare(a.name.toLowerCase(), b.name.toLowerCase()) || compare(a.name, b.name);

/** The line of ssh's stderr that says what went wrong, with a hint for the usual causes. */
export function sshProblem(stderr: string): string {
  const line = stderr
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter((text) => text && !text.startsWith("Warning:"))
    .pop()
    ?.replace(/^ssh: /, "");
  if (!line) return "ssh ended without saying why.";
  if (line.includes("Permission denied")) return `${line} Genbeya signs in with an SSH key or an agent, never with a password.`;
  if (line.includes("Host key verification failed")) return `${line} Connect once in a terminal to trust the host key.`;
  return line;
}

export interface RemoteFoldersOptions {
  /** Subfolders listed at most. */
  readonly limit?: number;
  /** Milliseconds an unused session stays open. */
  readonly idle?: number;
}

export class RemoteFolders {
  private readonly limit: number;
  private readonly idle: number;
  private cached: { readonly machine: string; readonly session: ShellSession } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = 0;

  constructor(
    private readonly hosts: Pick<HostFactory, "session" | "distributions">,
    { limit = MAX_FOLDERS, idle = IDLE_TIMEOUT }: RemoteFoldersOptions = {},
  ) {
    this.limit = limit;
    this.idle = idle;
  }

  /** The subfolders of `location`, whose path is absolute, or empty or starting with `~` for the home folder. */
  async list(location: RemoteLocation): Promise<FolderListing> {
    const home = isHome(location.path);
    const params = [home ? "1" : "0", home ? location.path.replace(/^~\/?/, "") : location.path, String(this.limit)];
    const session = this.session(location);
    clearTimeout(this.timer);
    this.running++;
    let reply;
    try {
      reply = await session.exec(`set -- ${params.map(quote).join(" ")}\n${LIST}`, LIST_TIMEOUT);
    } catch (error) {
      throw await this.explain(location, error);
    } finally {
      if (--this.running === 0) this.timer = setTimeout(() => this.release(), this.idle);
    }
    if (reply.code !== 0) {
      const shown = location.path === "" || location.path === "~" ? "Your home folder" : location.path;
      const failure = FAILURES[reply.code];
      throw new Error(failure ? `${shown} ${failure}` : reply.stderr.trim() || `Could not list ${shown}.`);
    }
    const [path = "/", ...records] = decodeLenient(reply.stdout).split("\0").filter(Boolean);
    const truncated = records.at(-1) === "+";
    const folders = (truncated ? records.slice(0, -1) : records).map((record) => ({
      name: record.slice(1),
      repository: record[0] === "r",
    }));
    return { path, parent: path === "/" ? null : posixPaths.dirname(path), folders: folders.sort(byName), truncated };
  }

  /** Closes the open session. */
  dispose(): void {
    this.release();
  }

  private session(location: RemoteLocation): ShellSession {
    const machine = location.kind === "wsl" ? `wsl:${location.distro}` : `ssh:${location.host}`;
    if (this.cached?.machine !== machine) {
      this.release();
      this.cached = { machine, session: this.hosts.session(location) };
    }
    return this.cached.session;
  }

  private release() {
    clearTimeout(this.timer);
    this.cached?.session.dispose();
    this.cached = null;
  }

  /** Names the machine that could not be reached, and why. */
  private async explain(location: RemoteLocation, error: unknown): Promise<unknown> {
    if (!(error instanceof ConnectionError)) return error;
    if (location.kind === "ssh") return new Error(`Can't connect to ${location.host}: ${sshProblem(error.detail)}`);
    if (!(await this.hosts.distributions()).includes(location.distro))
      return new Error(`WSL has no distribution named ${location.distro}.`);
    // wsl.exe may write UTF-16.
    const detail = error.detail.replace(/\0/g, "").trim();
    return new Error(`Can't connect to WSL (${location.distro}): ${detail || "wsl.exe ended without saying why."}`);
  }
}
