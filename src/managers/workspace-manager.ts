/** Opening, closing and observing repositories; the recent list, preferences, and folders on remote machines. */
import type { WorkspaceManagerContract } from "../contracts/manager-contracts";
import type { FolderListing, OpenedWorkspace, Preferences, Snapshot, Storage, Theme } from "../contracts/model";
import { RepositoryAccess } from "../access/git/repository-access";
import { validateFolderLocation, validateLocation, type HostFactory } from "../access/hosts/host-factory";
import type { RemoteFolders } from "../access/hosts/remote-folders";
import type { PreferencesStore } from "../access/preferences/preferences-store";
import type { WikiEngine } from "../engines/wiki-engine";
import { sha256 } from "../utilities/bytes";
import { buildFileTree } from "../utilities/file-tree";
import { requestedLink, requestedLocation } from "../utilities/launch-request";
import { namesRemoteHelper } from "../utilities/remote-url";
import { Workspace, type Engines, type WorkspaceRegistry } from "./workspace";

const THEMES: readonly Theme[] = ["system", "light", "dark"];
const CLONE_TIMEOUT = 15 * 60_000;

const remoteUrls = (snapshot: Snapshot) => snapshot.remotes.map((remote) => remote.url);

export class WorkspaceManager implements WorkspaceManagerContract {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly hosts: HostFactory,
    private readonly folders: RemoteFolders,
    private readonly preferencesStore: PreferencesStore,
    private readonly engines: Engines & { readonly wiki: WikiEngine },
  ) {}

  async open(location: unknown): Promise<OpenedWorkspace> {
    const trusted = validateLocation(location);
    const host = this.hosts.connect(trusted);
    let workspace: Workspace;
    try {
      workspace = new Workspace(trusted, host, new RepositoryAccess(host, await RepositoryAccess.locate(host, trusted.path)), this.engines);
    } catch (error) {
      host.dispose();
      throw error;
    }
    let snapshot: Snapshot;
    try {
      snapshot = await this.compose(workspace);
    } catch (error) {
      workspace.dispose();
      throw error;
    }
    const id = this.registry.activate(workspace);
    this.preferencesStore.remember(trusted, snapshot.settings.name, remoteUrls(snapshot));
    return { id, snapshot };
  }

  /** Null when there is nothing to reopen; a repository that cannot be opened (moved, host down) rejects. */
  async restore(launchArgs: unknown): Promise<OpenedWorkspace | null> {
    // A reloaded client keeps the open repository, under a new id.
    const current = this.registry.current();
    if (current) return { id: this.registry.activate(current), snapshot: await current.exclusive(() => this.compose(current)) };
    const args = Array.isArray(launchArgs) ? launchArgs : [];
    // The client finds the clone a link names; reopening the last repository first would be wasted.
    if (requestedLink(args)) return null;
    const requested = requestedLocation(args);
    if (requested !== undefined) return this.open(requested);
    const last = this.preferencesStore.recent[0];
    if (!this.preferencesStore.preferences.reopenLast || !last) return null;
    return this.open(last.location);
  }

  async clone(url: unknown, parent: unknown): Promise<OpenedWorkspace> {
    if (typeof url !== "string" || !url.trim() || url.length > 2048 || url.trim().startsWith("-") || /[\r\n\0]/.test(url))
      throw new Error("Enter a Git URL or repository path.");
    // A link's remote may end up here; git would run the program a <transport>::<address> names.
    if (namesRemoteHelper(url)) throw new Error("GitDesk does not clone through Git remote helpers (transport::address).");
    const where = validateLocation(parent);
    const name =
      url
        .trim()
        .replace(/[\\/]+$/, "")
        .split(/[\\/:]/)
        .pop()!
        .replace(/\.git$/, "")
        .replace(/[^A-Za-z0-9._-]/g, "-") || "repository";
    const host = this.hosts.connect(where);
    try {
      const result = await host.run("git", ["clone", "--", url.trim(), name], { cwd: where.path, timeout: CLONE_TIMEOUT });
      if (result.code !== 0) throw new Error(result.stderr.replace(/^fatal: /gm, "").trim());
      return await this.open({ ...where, path: host.paths.join(where.path, name) });
    } finally {
      host.dispose();
    }
  }

  /** Resolves right away; operations already running finish before the repository disconnects. */
  async close(id: unknown): Promise<void> {
    if (typeof id === "string") void this.registry.close(id);
  }

  async snapshot(id: unknown, since?: unknown): Promise<Snapshot | null> {
    const workspace = this.registry.get(id);
    const snapshot = await workspace.exclusive(() => this.compose(workspace));
    if (snapshot.version === since) return null;
    this.preferencesStore.rememberRemotes(workspace.location, remoteUrls(snapshot));
    return snapshot;
  }

  async recent() {
    return this.preferencesStore.recent;
  }

  async forget(location: unknown): Promise<void> {
    this.preferencesStore.forget(validateLocation(location));
  }

  async preferences(): Promise<Preferences> {
    return this.preferencesStore.preferences;
  }

  async setPreferences(change: unknown): Promise<Preferences> {
    const value = (change ?? {}) as Partial<Record<keyof Preferences, unknown>>;
    const next = { ...this.preferencesStore.preferences };
    if (value.theme !== undefined) {
      if (!THEMES.includes(value.theme as Theme)) throw new Error("Choose the system, light or dark theme.");
      next.theme = value.theme as Theme;
    }
    for (const key of ["reopenLast", "autoSyncContent"] as const)
      if (value[key] !== undefined) {
        if (typeof value[key] !== "boolean") throw new Error(`Invalid ${key} preference.`);
        next[key] = value[key];
      }
    this.preferencesStore.setPreferences(next);
    return next;
  }

  async distributions(): Promise<readonly string[]> {
    return this.hosts.distributions();
  }

  async browse(location: unknown): Promise<FolderListing> {
    return this.folders.list(validateFolderLocation(location));
  }

  /** Everything the client shows, stamped with a version of its content. */
  private async compose(workspace: Workspace): Promise<Snapshot> {
    const content = await workspace.content.locate();
    const separate = content.branch !== null;
    const [repository, contentFiles, contentBranch, loaded] = await Promise.all([
      workspace.repository.state(),
      separate ? workspace.content.files() : null,
      workspace.content.branchState(),
      workspace.settings(true),
    ]);
    const { settings, hash, problem } = loaded;
    const warnings = problem ? [problem] : [];
    if (workspace.content.commitFailure && content.branch)
      warnings.push(`Saved, but not committed to the ${content.branch} branch: ${workspace.content.commitFailure}`);
    const files = contentFiles ?? repository.files;
    const tasks = await workspace.tasks(files, settings, warnings);
    if (contentBranch?.uncommitted)
      warnings.push(
        `${contentBranch.uncommitted} file(s) on the ${contentBranch.branch} branch are not committed. Commit them in ${content.root}.`,
      );
    const storage: Storage = contentBranch
      ? {
          mode: "branch",
          branch: contentBranch.branch,
          remote: contentBranch.remote,
          ahead: contentBranch.head.ahead,
          behind: contentBranch.head.behind,
        }
      : { mode: "worktree" };
    const body: Omit<Snapshot, "version"> = {
      location: workspace.location,
      settings,
      settingsHash: hash,
      storage,
      head: repository.head,
      branches: repository.branches,
      remoteBranches: repository.remoteBranches,
      remotes: repository.remotes,
      changes: repository.changes,
      tags: repository.tags,
      stashes: repository.stashes,
      operation: repository.operation,
      files: buildFileTree(repository.files),
      wiki: this.engines.wiki.tree(files, settings),
      tasks,
      warnings,
    };
    return { version: sha256(JSON.stringify(body)), ...body };
  }
}
