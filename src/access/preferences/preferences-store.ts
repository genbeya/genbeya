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

interface State {
  readonly recent: readonly RecentEntry[];
  readonly preferences: Preferences;
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
  /** The save in progress, if any; saves never overlap. */
  private saving: Promise<void> = Promise.resolve();

  private constructor(
    private readonly machine: Machine,
    private readonly folder: string,
  ) {}

  private get file() {
    return this.machine.paths.join(this.folder, "state.json");
  }

  /** Loads the state; a missing or unreadable file starts fresh. */
  static async load(machine: Machine, folder: string): Promise<PreferencesStore> {
    const store = new PreferencesStore(machine, folder);
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
   * Writes pending changes now, after any save already in progress, so that
   * when this resolves everything changed so far is on disk (the app flushes
   * as it quits, possibly while a background save is still writing).
   */
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const save = this.saving.then(() => this.write());
    this.saving = save.catch(() => undefined);
    return save;
  }

  /**
   * The state goes to a temporary file first and then replaces the old one
   * (rename replaces files on every platform), so a crash mid-write never
   * leaves a truncated file.
   */
  private async write(): Promise<void> {
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
