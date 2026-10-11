/** Opening, closing and observing repositories; the recent list, preferences, and folders on remote machines. */
import type { WorkspaceManagerContract } from "../contracts/manager-contracts";
import {
  CHANGE_BASES,
  type ChangeBase,
  type ContentArea,
  type FolderListing,
  type OpenedWorkspace,
  type Preferences,
  type Snapshot,
  type Storage,
  type Theme,
} from "../contracts/model";
import { Git } from "../access/git/git";
import { RepositoryAccess } from "../access/git/repository-access";
import type { Host } from "../access/hosts/host";
import { validateFolderLocation, validateLocation, type HostFactory } from "../access/hosts/host-factory";
import type { RemoteFolders } from "../access/hosts/remote-folders";
import type { PreferencesStore } from "../access/preferences/preferences-store";
import type { SampleEngine } from "../engines/sample-engine";
import type { WikiEngine } from "../engines/wiki-engine";
import { encodeText, sha256 } from "../utilities/bytes";
import { buildFileTree } from "../utilities/file-tree";
import { requestedLink, requestedLocation } from "../utilities/launch-request";
import { namesRemoteHelper } from "../utilities/remote-url";
import { parseVersion } from "../utilities/version";
import { Workspace, type Engines, type WorkspaceRegistry } from "./workspace";

const THEMES: readonly Theme[] = ["system", "light", "dark"];
const CLONE_TIMEOUT = 15 * 60_000;
const TOUR_OFFERS = 100;

const isRepositoryKey = (key: unknown): key is string =>
  typeof key === "string" && key.length > 0 && key.length < 5000 && !/[\0\r\n]/.test(key);

const remoteUrls = (snapshot: Snapshot) => snapshot.remotes.map((remote) => remote.url);

/** `name`, or `name-2`, `name-3`, …: the first that does not exist in `folder` yet. */
async function freeFolder(host: Host, folder: string, name: string): Promise<string> {
  for (let i = 1; i <= 100; i++) {
    const candidate = i === 1 ? name : `${name}-${i}`;
    if (!(await host.kind(folder, candidate))) return candidate;
  }
  throw new Error(`${folder} already has a hundred ${name} folders.`);
}

export class WorkspaceManager implements WorkspaceManagerContract {
  constructor(
    private readonly registry: WorkspaceRegistry,
    private readonly hosts: HostFactory,
    private readonly folders: RemoteFolders,
    private readonly preferencesStore: PreferencesStore,
    private readonly engines: Engines & { readonly wiki: WikiEngine; readonly sample: SampleEngine },
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

  async createSample(parent: unknown): Promise<OpenedWorkspace> {
    const where = validateLocation(parent);
    const host = this.hosts.connect(where);
    let path: string;
    try {
      const name = await freeFolder(host, where.path, this.engines.sample.folderName);
      const init = await host.run("git", ["init", "--quiet", "--initial-branch=main", "--", name], { cwd: where.path });
      if (init.code !== 0) throw new Error(init.stderr.replace(/^fatal: /gm, "").trim() || "Could not create the sample repository.");
      path = host.paths.join(where.path, name);
      const git = new Git(host, path);
      for (const step of this.engines.sample.steps()) {
        for (const file of step.files) await host.write(path, file.path, encodeText(file.content), false);
        if (!step.message) continue;
        await git.text(["add", "--all"]);
        // GitDesk wrote these commits, not the user, whose identity may not even be set up yet.
        await git.text([
          "-c",
          "user.name=GitDesk",
          "-c",
          "user.email=sample@gitdesk.invalid",
          "commit",
          "--quiet",
          "--no-gpg-sign",
          "-m",
          step.message,
        ]);
      }
    } finally {
      host.dispose();
    }
    return this.open({ ...where, path });
  }

  /** Resolves right away; operations already running finish before the repository disconnects. */
  async close(id: unknown): Promise<void> {
    if (typeof id === "string") void this.registry.close(id);
  }

  async snapshot(id: unknown, since?: unknown, base?: unknown): Promise<Snapshot | null> {
    const workspace = this.registry.get(id);
    if (base !== undefined && base !== null && !CHANGE_BASES.includes(base as ChangeBase)) throw new Error("Invalid comparison base.");
    const snapshot = await workspace.exclusive(() => this.compose(workspace, (base as ChangeBase | null | undefined) ?? "head"));
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
    for (const key of ["reopenLast", "autoSyncContent", "minimap", "tourSeen"] as const)
      if (value[key] !== undefined) {
        if (typeof value[key] !== "boolean") throw new Error(`Invalid ${key} preference.`);
        next[key] = value[key];
      }
    if (value.lastSeenVersion !== undefined) {
      if (!parseVersion(value.lastSeenVersion)) throw new Error("Invalid lastSeenVersion preference.");
      next.lastSeenVersion = (value.lastSeenVersion as string).trim();
    }
    if (value.tourOffered !== undefined) {
      const keys = value.tourOffered;
      if (!Array.isArray(keys) || !keys.every(isRepositoryKey)) throw new Error("Invalid tourOffered preference.");
      // The repositories opened last are enough to offer the tour once in each.
      next.tourOffered = keys.slice(-TOUR_OFFERS);
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

  /** Everything the client shows, stamped with a version of its content; staged changes are compared with `base`. */
  private async compose(workspace: Workspace, base: ChangeBase = "head"): Promise<Snapshot> {
    const { areas, branch: content } = await workspace.content.layout();
    const readsBranch = content && (areas.wiki === "branch" || areas.tasks === "branch");
    const [repository, branchFiles, contentBranch, loaded] = await Promise.all([
      workspace.repository.state(base),
      readsBranch ? content.git.files() : null,
      workspace.content.branchState(),
      workspace.settings(true),
    ]);
    const filesOf = (area: ContentArea) => (areas[area] === "branch" && branchFiles ? branchFiles : repository.files);
    const { settings, hash, problem } = loaded;
    const warnings = problem ? [problem] : [];
    if (workspace.content.commitFailure && content)
      warnings.push(`Saved, but not committed to the ${content.branch} branch: ${workspace.content.commitFailure}`);
    const tasks = await workspace.tasks(filesOf("tasks"), settings, warnings);
    if (contentBranch?.uncommitted)
      warnings.push(
        `${contentBranch.uncommitted} file(s) on the ${contentBranch.branch} branch are not committed. Commit them in ${content!.root}.`,
      );
    const storage: Storage = {
      areas,
      branch: contentBranch && {
        name: contentBranch.branch,
        remote: contentBranch.remote,
        ahead: contentBranch.head.ahead,
        behind: contentBranch.head.behind,
      },
    };
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
      ...(repository.amending ? { amending: repository.amending } : {}),
      files: buildFileTree(repository.files),
      wiki: this.engines.wiki.tree(filesOf("wiki"), settings),
      tasks,
      warnings,
    };
    return { version: sha256(JSON.stringify(body)), ...body };
  }
}
