/**
 * The managers, from the parts a shell chooses: which machines repositories
 * may be on, and whether launch arguments open one. `createBackend`
 * (backend.ts) has everything; `createLocalBackend` (local-backend.ts) only
 * what opens repositories on this computer.
 */
import type { Managers } from "../contracts/manager-contracts";
import type { FolderBrowser, Hosts } from "../access/hosts/host";
import type { Machine } from "../access/ports";
import { PreferencesStore } from "../access/preferences/preferences-store";
import { AgentEngine } from "../engines/agent-engine";
import { LinkEngine } from "../engines/link-engine";
import { PatchEngine } from "../engines/patch-engine";
import { PeopleEngine } from "../engines/people-engine";
import { RebaseEngine } from "../engines/rebase-engine";
import { SampleEngine } from "../engines/sample-engine";
import { SearchEngine } from "../engines/search-engine";
import { SettingsEngine } from "../engines/settings-engine";
import { PullEngine } from "../engines/pull-engine";
import { TaskEngine } from "../engines/task-engine";
import { WikiEngine } from "../engines/wiki-engine";
import { ContentManager } from "./content-manager";
import { TerminalManager } from "./terminal-manager";
import { VersionControlManager } from "./version-control-manager";
import { WorkspaceManager, type LaunchRequests } from "./workspace-manager";
import { WorkspaceRegistry } from "./workspace";

export interface Backend extends Managers {
  /** Closes repositories (ending their terminals) and remote sessions, and saves pending preferences. */
  dispose(): Promise<void>;
}

export interface BackendParts {
  readonly hosts: Hosts;
  readonly folders: FolderBrowser;
  /** Null where nothing launches the shell with arguments. */
  readonly launch: LaunchRequests | null;
}

/** Managers for `machine` with `parts`; preferences live in `dataFolder`. */
export async function composeBackend(machine: Machine, dataFolder: string, { hosts, folders, launch }: BackendParts): Promise<Backend> {
  const engines = {
    settings: new SettingsEngine(),
    tasks: new TaskEngine(),
    pulls: new PullEngine(),
    wiki: new WikiEngine(),
    agents: new AgentEngine(),
    links: new LinkEngine(),
    sample: new SampleEngine(),
    search: new SearchEngine(),
    people: new PeopleEngine(),
  };
  const registry = new WorkspaceRegistry();
  const preferences = await PreferencesStore.load(machine, dataFolder);
  return {
    workspace: new WorkspaceManager(registry, hosts, folders, preferences, engines, launch),
    content: new ContentManager(registry, engines),
    versionControl: new VersionControlManager(registry, new RebaseEngine(), new PatchEngine()),
    terminal: new TerminalManager(registry, machine.terminals),
    async dispose() {
      folders.dispose();
      await registry.closeAll();
      await preferences.flush();
    },
  };
}
