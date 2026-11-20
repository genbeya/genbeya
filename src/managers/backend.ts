/**
 * The managers with everything, for the desktop shells: Electron and Deno
 * with the Node machine, Tauri with its own. Repositories may be on WSL and
 * SSH, and launch arguments open them.
 */
import { HostFactory } from "../access/hosts/host-factory";
import { RemoteFolders } from "../access/hosts/remote-folders";
import type { Machine } from "../access/ports";
import { requestedLink, requestedLocation } from "../utilities/launch-request";
import { composeBackend, type Backend } from "./compose-backend";

export type { Backend } from "./compose-backend";

/** Managers for `machine`; preferences live in `dataFolder`. */
export function createBackend(machine: Machine, dataFolder: string): Promise<Backend> {
  const hosts = new HostFactory(machine);
  return composeBackend(machine, dataFolder, { hosts, folders: new RemoteFolders(hosts), launch: { requestedLink, requestedLocation } });
}
