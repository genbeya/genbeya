/** The user's recent repositories and preferences, as JSON in the app's data folder. */
import { sameLocation, type Location, type Preferences, type RecentEntry } from "../../contracts/model";
import { decodeLenient, encodeText } from "../../utilities/bytes";
import type { Machine } from "../ports";

export const DEFAULT_PREFERENCES: Preferences = { theme: "system", reopenLast: true, autoSyncContent: false };
const RECENT_LIMIT = 20;
const SAVE_DELAY = 300;

interface State {
  readonly recent: readonly RecentEntry[];
  readonly preferences: Preferences;
}

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
    return this.machine.paths.join(this.folder, "state.json");
  }

  /** Loads the state; a missing or unreadable file starts fresh. */
  static async load(machine: Machine, folder: string): Promise<PreferencesStore> {
    const store = new PreferencesStore(machine, folder);
    try {
      const saved = JSON.parse(decodeLenient(await machine.fileSystem.readFile(store.file))) as Partial<State>;
      store.state = {
        recent: Array.isArray(saved.recent) ? saved.recent.slice(0, RECENT_LIMIT) : [],
        preferences: { ...DEFAULT_PREFERENCES, ...saved.preferences },
      };
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

  remember(location: Location, name: string, now = Date.now()): void {
    const others = this.state.recent.filter((entry) => !sameLocation(entry.location, location));
    this.update({ recent: [{ location, name, openedAt: now }, ...others].slice(0, RECENT_LIMIT) });
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
