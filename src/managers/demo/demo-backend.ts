/**
 * The composition root of the web demo's managers: the app's contracts,
 * implemented on in-memory repositories with the app's engines, so the
 * client runs unchanged in a web page. It starts with the sample project
 * open; everything lives as long as the page.
 */
import type { Managers, TerminalManagerContract } from "../../contracts/manager-contracts";
import type { Identity, MemoryRepository } from "../../access/memory/memory-repository";
import { AgentEngine } from "../../engines/agent-engine";
import { DemoEngine } from "../../engines/demo-engine";
import { LinkEngine } from "../../engines/link-engine";
import { PatchEngine } from "../../engines/patch-engine";
import { PeopleEngine } from "../../engines/people-engine";
import { RebaseEngine } from "../../engines/rebase-engine";
import { SampleEngine } from "../../engines/sample-engine";
import { SearchEngine } from "../../engines/search-engine";
import { SettingsEngine } from "../../engines/settings-engine";
import { PullEngine } from "../../engines/pull-engine";
import { TaskEngine } from "../../engines/task-engine";
import { WikiEngine } from "../../engines/wiki-engine";
import { DemoContentManager } from "./demo-content-manager";
import { createDemoRepository, createSampleRepository, type DemoRepositoryOptions } from "./demo-sample";
import { DemoVersionControlManager } from "./demo-version-control-manager";
import { DemoWorkspaceManager } from "./demo-workspace-manager";
import { DemoRegistry } from "./demo-workspace";

export const TERMINAL_UNAVAILABLE = "The terminal isn't available in the demo.";

/** Who the visitor commits and comments as. */
export const VISITOR: Identity = { name: "You", email: "you@example.com" };

export interface DemoOptions {
  readonly now?: () => Date;
  /** How long a request to the simulated remote takes, in milliseconds. */
  readonly networkDelay?: number;
  /** What a request to a remote does instead of waiting `networkDelay`, such as refusing. */
  readonly network?: () => Promise<void>;
  /** The repository that waits in the demo folder and opens first, instead of the sample project's. */
  readonly repository?: (options: DemoRepositoryOptions) => { readonly name: string; readonly repository: MemoryRepository };
}

function createEngines() {
  return {
    settings: new SettingsEngine(),
    tasks: new TaskEngine(),
    pulls: new PullEngine(),
    wiki: new WikiEngine(),
    agents: new AgentEngine(),
    links: new LinkEngine(),
    sample: new SampleEngine(),
    search: new SearchEngine(),
    people: new PeopleEngine(),
    demo: new DemoEngine(),
  };
}

/** The terminal: there are no processes in a web page. */
const terminal: TerminalManagerContract = {
  available: async () => false,
  open: async () => {
    throw new Error(TERMINAL_UNAVAILABLE);
  },
  write: async () => {
    throw new Error(TERMINAL_UNAVAILABLE);
  },
  resize: async () => {
    throw new Error(TERMINAL_UNAVAILABLE);
  },
  read: async () => {
    throw new Error(TERMINAL_UNAVAILABLE);
  },
  close: async () => undefined,
};

export function createDemoBackend({ now = () => new Date(), networkDelay = 400, network, repository }: DemoOptions = {}): Managers {
  const engines = createEngines();
  const options = { identity: VISITOR, now };
  const registry = new DemoRegistry();
  const workspace = new DemoWorkspaceManager(registry, engines, () => createSampleRepository(engines.sample, options));
  // The sample repository, or the one given, waits in the demo folder, and opens first.
  const first = repository?.(options) ?? { name: engines.sample.folderName, repository: createDemoRepository(engines, options) };
  workspace.add(first.name, first.repository);
  const delay = () => new Promise<void>((resolve) => setTimeout(resolve, networkDelay));
  return {
    workspace,
    content: new DemoContentManager(registry, engines),
    versionControl: new DemoVersionControlManager(registry, new RebaseEngine(), new PatchEngine(), network ?? delay),
    terminal,
  };
}
