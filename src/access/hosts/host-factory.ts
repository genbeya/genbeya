/** Connects to the machines repository locations name: this computer, WSL distributions and SSH servers. */
import type { Location, RemoteLocation } from "../../contracts/model";
import type { Machine } from "../ports";
import type { Host, Hosts } from "./host";
import { LocalHost } from "./local-host";
import { ShellHost } from "./shell-host";
import { ShellSession } from "./shell-session";
import { localTerminal, sshTerminal, wslTerminal } from "./terminal-commands";

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

export class HostFactory implements Hosts {
  constructor(private readonly machine: Machine) {}

  connect(location: Location): Host {
    if (location.kind === "local") return new LocalHost(this.machine, localTerminal);
    const terminal =
      location.kind === "wsl" ? (path: string) => wslTerminal(location.distro, path) : (path: string) => sshTerminal(location.host, path);
    return new ShellHost(this.session(location), terminal);
  }

  /** A shell on the WSL distribution or SSH server of `location`; it connects on first use. */
  session(location: RemoteLocation): ShellSession {
    if (location.kind === "wsl")
      return new ShellSession(this.machine.processes, "wsl.exe", ["-d", location.distro, "-e", "sh"], `WSL (${location.distro})`);
    return new ShellSession(
      this.machine.processes,
      "ssh",
      ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "--", location.host, "sh"],
      location.host,
    );
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
