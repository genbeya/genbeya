/**
 * Hosts for a shell that opens repositories on this computer only, such as
 * the VS Code extension: VS Code reaches WSL, SSH and containers itself and
 * runs the extension there. Nothing here starts a shell on another machine.
 */
import type { FolderListing, Location } from "../../contracts/model";
import type { Machine } from "../ports";
import type { FolderBrowser, Host, Hosts } from "./host";
import { LocalHost } from "./local-host";

export const LOCAL_ONLY = "Genbeya opens repositories on this computer here.";

export class LocalHosts implements Hosts, FolderBrowser {
  constructor(private readonly machine: Machine) {}

  connect(location: Location): Host {
    if (location.kind !== "local") throw new Error(LOCAL_ONLY);
    return new LocalHost(this.machine);
  }

  async distributions(): Promise<string[]> {
    return [];
  }

  async list(): Promise<FolderListing> {
    throw new Error(LOCAL_ONLY);
  }

  /** Holds no sessions to close. */
  dispose(): void {
    return;
  }
}
