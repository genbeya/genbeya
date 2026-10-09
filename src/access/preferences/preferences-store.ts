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
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  /** Writes pending changes now. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.machine.fileSystem.makeDirectory(this.folder);
    await this.machine.fileSystem.writeFile(this.file, encodeText(JSON.stringify(this.state, null, 2)), false);
  }
}
