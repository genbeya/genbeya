/**
 * The composition root of the managers, used by every shell: Electron and
 * Deno with the Node machine, Tauri with its own.
 */
import type { Managers } from "../contracts/manager-contracts";
import { HostFactory } from "../access/hosts/host-factory";
import type { Machine } from "../access/ports";
import { PreferencesStore } from "../access/preferences/preferences-store";
import { SettingsEngine } from "../engines/settings-engine";
import { TaskEngine } from "../engines/task-engine";
import { WikiEngine } from "../engines/wiki-engine";
import { ContentManager } from "./content-manager";
import { VersionControlManager } from "./version-control-manager";
import { WorkspaceManager } from "./workspace-manager";
import { WorkspaceRegistry } from "./workspace";

export interface Backend extends Managers {
  /** Closes repositories and saves pending preferences. */
  dispose(): Promise<void>;
}

/** Managers for `machine`; preferences live in `dataFolder`. */
export async function createBackend(machine: Machine, dataFolder: string): Promise<Backend> {
  const engines = { settings: new SettingsEngine(), tasks: new TaskEngine(), wiki: new WikiEngine() };
  const registry = new WorkspaceRegistry();
  const preferences = await PreferencesStore.load(machine, dataFolder);
  return {
    workspace: new WorkspaceManager(registry, new HostFactory(machine), preferences, engines),
    content: new ContentManager(registry, engines),
    versionControl: new VersionControlManager(registry),
    async dispose() {
      registry.closeAll();
      await preferences.flush();
    },
  };
}
