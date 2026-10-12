/**
 * Opening and observing repositories in the web demo. Its machine has one
 * folder, {@link DEMO_FOLDER}, holding the sample repository it starts
 * with and any sample created from the welcome screen; nothing on the
 * visitor's computer is reachable, and preferences last as long as the page.
 */
import type { WorkspaceManagerContract } from "../../contracts/manager-contracts";
import {
  CHANGE_BASES,
  CONTENT_AREAS,
  type Amending,
  type ChangeBase,
  type FolderListing,
  type Location,
  type OpenedWorkspace,
  type Preferences,
  type RecentEntry,
  type Snapshot,
} from "../../contracts/model";
import { restage } from "../../access/git/staging-access";
import type { MemoryRepository } from "../../access/memory/memory-repository";
import { DEFAULT_PREFERENCES } from "../../access/preferences/preferences-store";
import type { SampleEngine } from "../../engines/sample-engine";
import { SETTINGS_FILE } from "../../engines/settings-engine";
import type { WikiEngine } from "../../engines/wiki-engine";
import { sha256 } from "../../utilities/bytes";
import { buildFileTree } from "../../utilities/file-tree";
import { changePreferences } from "../preference-change";
import { DemoWorkspace, type DemoEngines, type DemoRegistry } from "./demo-workspace";

/** The demo machine's only folder. */
export const DEMO_FOLDER = "/demo";

export const NO_FOLDERS = "The demo can't open folders on your computer. Download Genbeya to open your own repositories.";
const NO_NETWORK = "The demo can't clone repositories: it doesn't reach the network. Download Genbeya to clone.";
const NO_MACHINES = "The demo can't reach WSL or SSH. Download Genbeya to open repositories there.";

/** The demo's folder for `location`; anything else is out of reach. */
function demoPath(location: unknown): string {
  const { kind, path } = (location ?? {}) as Partial<Record<string, unknown>>;
  if (kind !== "local") throw new Error(NO_MACHINES);
  if (typeof path !== "string" || (path !== DEMO_FOLDER && !path.startsWith(`${DEMO_FOLDER}/`))) throw new Error(NO_FOLDERS);
  return path;
}

export class DemoWorkspaceManager implements WorkspaceManagerContract {
  /** The repositories of the demo machine, by path. */
  private readonly repositories = new Map<string, MemoryRepository>();
  private preferenceState: Preferences = DEFAULT_PREFERENCES;
  private recentList: RecentEntry[] = [];

  constructor(
    private readonly registry: DemoRegistry,
    private readonly engines: DemoEngines & { readonly wiki: WikiEngine; readonly sample: SampleEngine },
    /** Makes a new sample repository. */
    private readonly createSampleRepository: () => MemoryRepository,
  ) {}

  /** Puts a repository into the demo's folder, as if it had been cloned there and opened before. */
  add(name: string, repository: MemoryRepository): Location {
    const location: Location = { kind: "local", path: `${DEMO_FOLDER}/${name}` };
    this.repositories.set(location.path, repository);
    const settings = repository.worktree.get(SETTINGS_FILE);
    const fallback = this.engines.settings.defaults(name);
    const title = settings === undefined ? fallback.name : this.engines.settings.parse(settings, fallback, false).name;
    this.recentList = [
      { location, name: title, openedAt: Date.now(), remotes: repository.sync.list().map((remote) => remote.url) },
      ...this.recentList,
    ];
    return location;
  }

  async open(location: unknown): Promise<OpenedWorkspace> {
    const path = demoPath(location);
    const repository = this.repositories.get(path);
    if (!repository) throw new Error(NO_FOLDERS);
    const workspace = new DemoWorkspace({ kind: "local", path }, repository, this.engines);
    const snapshot = await this.compose(workspace);
    const id = this.registry.activate(workspace);
    this.remember(workspace.location, snapshot);
    return { id, snapshot };
  }

  /** Reopens the open repository for a reloaded client, else the last one. */
  async restore(): Promise<OpenedWorkspace | null> {
    const current = this.registry.current();
    if (current) return { id: this.registry.activate(current), snapshot: await current.exclusive(() => this.compose(current)) };
    const last = this.recentList[0];
    return this.preferenceState.reopenLast && last ? this.open(last.location) : null;
  }

  async clone(): Promise<OpenedWorkspace> {
    throw new Error(NO_NETWORK);
  }

  async createSample(parent: unknown): Promise<OpenedWorkspace> {
    const folder = demoPath(parent);
    const name = this.engines.sample.folderName;
    const free = [1, ...Array.from({ length: 99 }, (_, i) => i + 2)]
      .map((n) => `${folder}/${n === 1 ? name : `${name}-${n}`}`)
      .find((path) => !this.repositories.has(path));
    if (!free) throw new Error(`${folder} already has a hundred ${name} folders.`);
    this.repositories.set(free, this.createSampleRepository());
    return this.open({ kind: "local", path: free });
  }

  async close(id: unknown): Promise<void> {
    if (typeof id === "string") this.registry.close(id);
  }

  async snapshot(id: unknown, since?: unknown, base?: unknown): Promise<Snapshot | null> {
    const workspace = this.registry.get(id);
    if (base !== undefined && base !== null && !CHANGE_BASES.includes(base as ChangeBase)) throw new Error("Invalid comparison base.");
    const snapshot = await workspace.exclusive(() => this.compose(workspace, (base as ChangeBase | null | undefined) ?? "head"));
    return snapshot.version === since ? null : snapshot;
  }

  async recent(): Promise<readonly RecentEntry[]> {
    return this.recentList;
  }

  async forget(location: unknown): Promise<void> {
    const path = demoPath(location);
    this.recentList = this.recentList.filter((entry) => entry.location.path !== path);
  }

  async preferences(): Promise<Preferences> {
    return this.preferenceState;
  }

  async setPreferences(change: unknown): Promise<Preferences> {
    return (this.preferenceState = changePreferences(this.preferenceState, change));
  }

  async distributions(): Promise<readonly string[]> {
    return [];
  }

  async browse(): Promise<FolderListing> {
    throw new Error(NO_MACHINES);
  }

  private remember(location: Location, snapshot: Snapshot) {
    const entry: RecentEntry = {
      location,
      name: snapshot.settings.name,
      openedAt: Date.now(),
      remotes: snapshot.remotes.map((remote) => remote.url),
    };
    this.recentList = [entry, ...this.recentList.filter((other) => other.location.path !== location.path)];
  }

  /** Everything the client shows, stamped with a version of its content; staged changes are compared with `base`. */
  private async compose(workspace: DemoWorkspace, base: ChangeBase = "head"): Promise<Snapshot> {
    const repository = workspace.repository;
    const { settings, hash, problem } = await workspace.settings(true);
    const files = repository.files();
    const warnings = problem ? [problem] : [];
    const tasks = await workspace.tasks(files, settings, warnings);
    const amending = base === "parent" ? amendingOf(repository) : null;
    const changes = repository.status();
    const branches = [...repository.branches.keys()].sort();
    const body: Omit<Snapshot, "version"> = {
      location: workspace.location,
      settings,
      settingsHash: hash,
      // Content stays in the checkout: the demo has no content branch.
      storage: { areas: Object.fromEntries(CONTENT_AREAS.map((area) => [area, "checkout"])) as Snapshot["storage"]["areas"], branch: null },
      head: repository.headState(),
      branches,
      // Remote branches with a local counterpart are switched to through that.
      remoteBranches: [...repository.tracking.keys()].filter((ref) => !branches.includes(ref.slice(ref.indexOf("/") + 1))).sort(),
      remotes: repository.sync.list(),
      changes: amending
        ? restage(
            changes,
            repository.changedFiles(
              repository.treeOf(repository.commits.get(repository.headCommit()!).parents[0] ?? null),
              repository.index,
            ),
          )
        : changes,
      tags: [...repository.tags.keys()].sort(),
      stashes: repository.stashes.list(),
      operation: repository.operations.current(),
      ...(amending ? { amending } : {}),
      files: buildFileTree(files),
      wiki: this.engines.wiki.tree(files, settings),
      tasks,
      warnings,
    };
    return { version: sha256(JSON.stringify(body)), ...body };
  }
}

/** The commit an amend replaces; null before the first commit. */
export function amendingOf(repository: MemoryRepository): Amending | null {
  const head = repository.headCommit();
  if (!head) return null;
  const { parents } = repository.commits.get(head);
  const pushed = [...repository.tracking]
    .filter(([, tip]) => repository.commits.isAncestor(head, tip))
    .map(([name]) => name)
    .sort();
  return { commit: head.slice(0, 7), parent: parents[0]?.slice(0, 7) ?? null, merge: parents.length > 1, pushed };
}
