/**
 * The composition root of the managers, used by every shell: Electron and
 * Deno with the Node machine, Tauri with its own.
 */
import type { Managers } from "../contracts/manager-contracts";
import { HostFactory } from "../access/hosts/host-factory";
import { RemoteFolders } from "../access/hosts/remote-folders";
import type { Machine } from "../access/ports";
import { PreferencesStore } from "../access/preferences/preferences-store";
import { AgentEngine } from "../engines/agent-engine";
import { LinkEngine } from "../engines/link-engine";
import { RebaseEngine } from "../engines/rebase-engine";
import { SampleEngine } from "../engines/sample-engine";
import { SearchEngine } from "../engines/search-engine";
import { SettingsEngine } from "../engines/settings-engine";
import { TaskEngine } from "../engines/task-engine";
import { WikiEngine } from "../engines/wiki-engine";
import { ContentManager } from "./content-manager";
import { TerminalManager } from "./terminal-manager";
import { VersionControlManager } from "./version-control-manager";
import { WorkspaceManager } from "./workspace-manager";
import { WorkspaceRegistry } from "./workspace";

export interface Backend extends Managers {
  /** Closes repositories (ending their terminals) and remote sessions, and saves pending preferences. */
  dispose(): Promise<void>;
}

/** Managers for `machine`; preferences live in `dataFolder`. */
export async function createBackend(machine: Machine, dataFolder: string): Promise<Backend> {
  const engines = {
    settings: new SettingsEngine(),
    tasks: new TaskEngine(),
    wiki: new WikiEngine(),
    agents: new AgentEngine(),
    links: new LinkEngine(),
    sample: new SampleEngine(),
    search: new SearchEngine(),
  };
  const registry = new WorkspaceRegistry();
  const preferences = await PreferencesStore.load(machine, dataFolder);
  const hosts = new HostFactory(machine);
  const folders = new RemoteFolders(hosts);
  return {
    workspace: new WorkspaceManager(registry, hosts, folders, preferences, engines),
    content: new ContentManager(registry, engines),
    versionControl: new VersionControlManager(registry, new RebaseEngine()),
    terminal: new TerminalManager(registry, machine.terminals),
    async dispose() {
      folders.dispose();
      await registry.closeAll();
      await preferences.flush();
    },
  };
}
