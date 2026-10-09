/** Validates repository locations and connects to the machines they name. */
import type { Location } from "../../contracts/model";
import type { Machine } from "../ports";
import type { Host } from "./host";
import { LocalHost } from "./local-host";
import { ShellHost } from "./shell-host";
import { ShellSession } from "./shell-session";

const SSH_DESTINATION = /^(ssh:\/\/)?[A-Za-z0-9._@:[\]%-]+$/;
const MAX_TEXT = 4096;
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

const isText = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length < MAX_TEXT && !/[\0\r\n]/.test(value);

/** A trusted copy of a client-supplied location, or an error. */
export function validateLocation(value: unknown): Location {
  const location = value as Partial<Record<"kind" | "path" | "distro" | "host", unknown>> | null;
  if (!location || typeof location !== "object" || !isText(location.path)) throw new Error("Invalid repository location.");
  const path = location.path;
  if (location.kind === "local") return { kind: "local", path };
  if (!path.startsWith("/")) throw new Error("Use an absolute path on the remote machine, such as /home/me/project.");
  // A leading "-" would turn a name into an option of wsl.exe or ssh.
  if (location.kind === "wsl" && isText(location.distro) && !location.distro.startsWith("-"))
    return { kind: "wsl", distro: location.distro, path };
  if (location.kind === "ssh" && isText(location.host) && !location.host.startsWith("-") && SSH_DESTINATION.test(location.host))
    return { kind: "ssh", host: location.host, path };
  throw new Error("Invalid repository location.");
}

/** Maps `\\wsl$\Distro\path` and `\\wsl.localhost\Distro\path` to a WSL location. */
export function locationOfFolder(folder: string): Location {
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(\\.*)?$/i.exec(folder);
  if (!match) return { kind: "local", path: folder };
  return { kind: "wsl", distro: match[1]!, path: (match[2] ?? "\\").replace(/\\/g, "/") };
}

export class HostFactory {
  constructor(private readonly machine: Machine) {}

  connect(location: Location): Host {
    switch (location.kind) {
      case "local":
        return new LocalHost(this.machine);
      case "wsl":
        return new ShellHost(
          new ShellSession(this.machine.processes, "wsl.exe", ["-d", location.distro, "-e", "sh"], `WSL (${location.distro})`),
        );
      case "ssh":
        return new ShellHost(
          new ShellSession(
            this.machine.processes,
            "ssh",
            ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "--", location.host, "sh"],
            location.host,
          ),
        );
    }
  }

  /** WSL distributions of this machine; empty outside Windows or without WSL. */
  async distributions(): Promise<string[]> {
    if (this.machine.os !== "windows") return [];
    const result = await this.machine.processes.run("wsl.exe", ["-l", "-q"], { cwd: ".", timeout: 10_000 });
    if (result.code !== 0) return [];
    // wsl.exe writes UTF-16LE.
    return new TextDecoder("utf-16le")
      .decode(result.stdout)
      .replace(BYTE_ORDER_MARK, "")
      .split(/\r?\n/)
      .map((line) => line.replace(/\0/g, "").trim())
      .filter(Boolean);
  }
}
