/**
 * Repository locations a client names: validated before any host connects to
 * them, so a name can't turn into an option of wsl.exe or ssh.
 */
import type { Location, RemoteLocation } from "../../contracts/model";

const SSH_DESTINATION = /^(ssh:\/\/)?[A-Za-z0-9._@:[\]%-]+$/;
const MAX_TEXT = 4096;
const INVALID = "Invalid repository location.";

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length < MAX_TEXT && !/[\0\r\n]/.test(value);

type UntrustedLocation = Partial<Record<"kind" | "path" | "distro" | "host", unknown>>;

/** `location`'s WSL distribution or SSH server with `path`, or null when it names neither. */
function remote(location: UntrustedLocation, path: string): RemoteLocation | null {
  // A leading "-" would turn a name into an option of wsl.exe or ssh.
  if (location.kind === "wsl" && isText(location.distro) && !location.distro.startsWith("-"))
    return { kind: "wsl", distro: location.distro, path };
  if (location.kind === "ssh" && isText(location.host) && !location.host.startsWith("-") && SSH_DESTINATION.test(location.host))
    return { kind: "ssh", host: location.host, path };
  return null;
}

/** A trusted copy of a client-supplied location, or an error. */
export function validateLocation(value: unknown): Location {
  const location = value as UntrustedLocation | null;
  if (!location || typeof location !== "object" || !isText(location.path)) throw new Error(INVALID);
  const path = location.path;
  if (location.kind === "local") return { kind: "local", path };
  if (!path.startsWith("/")) throw new Error("Use an absolute path on the remote machine, such as /home/me/project.");
  const trusted = remote(location, path);
  if (!trusted) throw new Error(INVALID);
  return trusted;
}

/**
 * A trusted copy of a client-supplied folder on WSL or SSH to browse. Its
 * path is absolute, or empty or starting with `~` for the home folder.
 */
export function validateFolderLocation(value: unknown): RemoteLocation {
  const location = value as UntrustedLocation | null;
  if (!location || typeof location !== "object" || typeof location.path !== "string") throw new Error(INVALID);
  if (location.kind === "local") throw new Error("Choose folders on this computer with the folder dialog.");
  const path = location.path;
  if (path && !(isText(path) && (path.startsWith("/") || path === "~" || path.startsWith("~/"))))
    throw new Error("Use an absolute path, such as /home/me, or ~ for your home folder.");
  const trusted = remote(location, path);
  if (!trusted) throw new Error(INVALID);
  return trusted;
}

/** Maps `\\wsl$\Distro\path` and `\\wsl.localhost\Distro\path` to a WSL location. */
export function locationOfFolder(folder: string): Location {
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(\\.*)?$/i.exec(folder);
  if (!match) return { kind: "local", path: folder };
  return { kind: "wsl", distro: match[1]!, path: (match[2] ?? "\\").replace(/\\/g, "/") };
}
