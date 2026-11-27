/**
 * The managers for repositories on this computer only, for the VS Code
 * extension: no WSL or SSH hosts (VS Code runs the extension there itself),
 * no launch arguments, and terminals only if `machine` has them.
 */
import { LocalHosts } from "../access/hosts/local-hosts";
import type { Machine } from "../access/ports";
import { composeBackend, type Backend } from "./compose-backend";

/** Managers for `machine`'s own repositories; preferences live in `dataFolder`. */
export function createLocalBackend(machine: Machine, dataFolder: string): Promise<Backend> {
  const hosts = new LocalHosts(machine);
  return composeBackend(machine, dataFolder, { hosts, folders: hosts, launch: null });
}
