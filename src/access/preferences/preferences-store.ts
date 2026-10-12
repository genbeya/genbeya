/** The user's recent repositories and preferences, as JSON in the app's data folder. */
import { sameLocation, type Location, type Preferences, type RecentEntry } from "../../contracts/model";
import { decodeLenient, encodeText } from "../../utilities/bytes";
import { withoutCredentials } from "../../utilities/remote-url";
import type { Machine } from "../ports";

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  reopenLast: true,
  autoSyncContent: false,
  minimap: true,
  lastSeenVersion: null,
  tourSeen: false,
  tourOffered: [],
};
/** The last seen version of state saved before versions were remembered: all news is new to its user. */
export const UNKNOWN_VERSION = "0.0.0";
const RECENT_LIMIT = 20;
const SAVE_DELAY = 300;
const STATE_FILE = "state.json";

interface State {
  readonly recent: readonly RecentEntry[];
  readonly preferences: Preferences;
}

/**
 * Where the app kept its data before: the data folders of GitDesk, as
 * Genbeya was called before 0.5, most likely first, and the files a shell
 * keeps there besides the preferences, such as Electron's window bounds.
 */
export interface PreviousData {
  readonly folders: readonly string[];
  readonly files?: readonly string[];
}

/** The remote URLs a saved entry holds; entries saved before remotes were remembered have none. */
const savedRemotes = (entry: RecentEntry): string[] =>
  Array.isArray(entry.remotes) ? entry.remotes.filter((url): url is string => typeof url === "string") : [];

/**
 * Remotes are remembered to find the clone a link names, which needs no
 * credentials, so none reach the file. Older versions saved them.
 */
const withRemotes = (entry: RecentEntry): RecentEntry => ({ ...entry, remotes: savedRemotes(entry).map(withoutCredentials) });

export class PreferencesStore {
  private state: State = { recent: [], preferences: DEFAULT_PREFERENCES };
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Changes not yet on disk. */
  private dirty = false;

  private constructor(
    private readonly machine: Machine,
    private readonly folder: string,
  ) {}

  private get file() {
    return this.machine.paths.join(this.folder, STATE_FILE);
  }

  /**
   * Loads the state; a missing or unreadable file starts fresh. A data
   * folder without state takes over the state of the `previous` one first,
   * so an app that was renamed keeps its user's recent repositories and
   * preferences.
   */
  static async load(machine: Machine, folder: string, previous: PreviousData = { folders: [] }): Promise<PreferencesStore> {
    const store = new PreferencesStore(machine, folder);
    // Starting fresh is still better than not starting.
    await store.adopt(previous).catch(() => undefined);
    try {
      const saved = JSON.parse(decodeLenient(await machine.fileSystem.readFile(store.file))) as Partial<State>;
      const recent = Array.isArray(saved.recent) ? saved.recent.slice(0, RECENT_LIMIT) : [];
      store.state = {
        recent: recent.map(withRemotes),
        preferences: { ...DEFAULT_PREFERENCES, lastSeenVersion: UNKNOWN_VERSION, ...saved.preferences },
      };
      // A file with credentials in it is written again without them.
      const remotes = (entries: readonly RecentEntry[]) => JSON.stringify(entries.map(savedRemotes));
      if (remotes(recent) !== remotes(store.state.recent)) store.update({});
    } catch {
      /* First run or unreadable state. */
    }
    return store;
  }

  /**
   * Copies the state of the first of the previous folders that has any,
   * unless this folder has state of its own. Copies, never moves: the app
   * of the old name may still be installed. Files this folder has are kept,
   * and the state file comes last, so a copy cut short is made again.
   */
  private async adopt({ folders, files = [] }: PreviousData): Promise<void> {
    const { fileSystem, paths } = this.machine;
    const has = (path: string) =>
      fileSystem.stat(path).then(
        () => true,
        () => false,
      );
    if (await has(this.file)) return;
    for (const folder of folders) {
      if (paths.normalize(folder) === paths.normalize(this.folder)) continue;
      const state = await fileSystem.readFile(paths.join(folder, STATE_FILE)).catch(() => null);
      if (!state) continue;
      await fileSystem.makeDirectory(this.folder);
      for (const name of files) {
        const data = await fileSystem.readFile(paths.join(folder, name)).catch(() => null);
        if (data) await fileSystem.writeFile(paths.join(this.folder, name), data, true).catch(() => undefined);
      }
      await fileSystem.writeFile(this.file, state, true);
      return;
    }
  }

  get recent(): readonly RecentEntry[] {
    return this.state.recent;
  }

  get preferences(): Preferences {
    return this.state.preferences;
  }

  remember(location: Location, name: string, remotes: readonly string[], now = Date.now()): void {
    const others = this.state.recent.filter((entry) => !sameLocation(entry.location, location));
    this.update({
      recent: [{ location, name, openedAt: now, remotes: remotes.map(withoutCredentials) }, ...others].slice(0, RECENT_LIMIT),
    });
  }

  /** Records remotes added or removed since `location` was opened, without moving its entry. */
  rememberRemotes(location: Location, urls: readonly string[]): void {
    const remotes = urls.map(withoutCredentials);
    const changed = (entry: RecentEntry) =>
      sameLocation(entry.location, location) && JSON.stringify(entry.remotes) !== JSON.stringify(remotes);
    if (!this.state.recent.some(changed)) return;
    this.update({ recent: this.state.recent.map((entry) => (changed(entry) ? { ...entry, remotes } : entry)) });
  }

  forget(location: Location): void {
    this.update({ recent: this.state.recent.filter((entry) => !sameLocation(entry.location, location)) });
  }

  setPreferences(preferences: Preferences): void {
    this.update({ preferences });
  }

  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change };
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      // The changes stay pending; the next change or flush tries again.
      this.flush().catch(() => undefined);
    }, SAVE_DELAY);
  }

  /**
   * Writes pending changes now. The state goes to a temporary file first and
   * then replaces the old one (rename replaces files on every platform), so
   * a crash mid-write never leaves a truncated file.
   */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    this.dirty = false;
    const { fileSystem } = this.machine;
    const temporary = `${this.file}.tmp`;
    try {
      await fileSystem.makeDirectory(this.folder);
      await fileSystem.writeFile(temporary, encodeText(JSON.stringify(this.state, null, 2)), false);
      await fileSystem.rename(temporary, this.file);
    } catch (error) {
      this.dirty = true;
      throw error;
    }
  }
}
