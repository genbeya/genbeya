import { execFile } from "node:child_process";
import type { Location } from "../shared/api.js";
import type { Host } from "./host.js";
import { LocalHost } from "./local-host.js";
import { ShellHost, ShellSession } from "./shell-host.js";

const SSH_DESTINATION = /^(ssh:\/\/)?[A-Za-z0-9._@:[\]%-]+$/;

export function validateLocation(value: unknown): Location {
  const l = value as Location;
  const text = (v: unknown) => typeof v === "string" && v.length > 0 && v.length < 4096 && !/[\0\r\n]/.test(v);
  if (!l || typeof l !== "object" || !text(l.path)) throw new Error("Invalid repository location.");
  if (l.kind === "local") return { kind: "local", path: l.path };
  if (!l.path.startsWith("/")) throw new Error("Use an absolute path on the remote machine, such as /home/me/project.");
  if (l.kind === "wsl" && text(l.distro) && !l.distro.startsWith("-"))
    return { kind: "wsl", distro: l.distro, path: l.path };
  if (l.kind === "ssh" && text(l.host) && !l.host.startsWith("-") && SSH_DESTINATION.test(l.host))
    return { kind: "ssh", host: l.host, path: l.path };
  throw new Error("Invalid repository location.");
}

export function createHost(location: Location): Host {
  switch (location.kind) {
    case "local":
      return new LocalHost();
    case "wsl":
      return new ShellHost(
        new ShellSession("wsl.exe", ["-d", location.distro, "-e", "sh"], `WSL (${location.distro})`),
      );
    case "ssh":
      return new ShellHost(
        new ShellSession(
          "ssh",
          ["-T", "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "--", location.host, "sh"],
          location.host,
        ),
      );
  }
}

/** Maps `\\wsl$\Distro\path` and `\\wsl.localhost\Distro\path` to a WSL location. */
export function fromWindowsPath(folder: string): Location {
  const match = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)(\\.*)?$/i.exec(folder);
  if (!match) return { kind: "local", path: folder };
  return { kind: "wsl", distro: match[1], path: (match[2] ?? "\\").replace(/\\/g, "/") };
}

export function wslDistros(): Promise<string[]> {
  if (process.platform !== "win32") return Promise.resolve([]);
  return new Promise((resolve) =>
    execFile("wsl.exe", ["-l", "-q"], { encoding: "buffer", windowsHide: true, timeout: 10_000 }, (error, stdout) => {
      if (error) return resolve([]);
      // wsl.exe writes UTF-16LE.
      resolve(
        stdout
          .toString("utf16le")
          .replace(/^﻿/, "")
          .split(/\r?\n/)
          .map((s) => s.replace(/\0/g, "").trim())
          .filter(Boolean),
      );
    }),
  );
}
