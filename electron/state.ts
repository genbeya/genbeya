import { promises as fs } from "node:fs";
import path from "node:path";
import {
  sameLocation,
  type Location,
  type Preferences,
  type RecentEntry,
} from "../shared/api.js";

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

interface State {
  recent: RecentEntry[];
  preferences: Preferences;
  bounds: Bounds | null;
}

const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  reopenLast: true,
  autoSyncContent: false,
  plantumlServer: "",
};

/** Per-user application state, kept as JSON in Electron's userData folder. */
export class Store {
  private state: State = { recent: [], preferences: { ...DEFAULT_PREFERENCES }, bounds: null };
  private timer: NodeJS.Timeout | null = null;

  private constructor(private readonly file: string) {}

  static async load(folder: string) {
    const store = new Store(path.join(folder, "state.json"));
    try {
      const saved = JSON.parse(await fs.readFile(store.file, "utf8")) as Partial<State>;
      store.state = {
        recent: Array.isArray(saved.recent) ? saved.recent.slice(0, 20) : [],
        preferences: { ...DEFAULT_PREFERENCES, ...saved.preferences },
        bounds: saved.bounds ?? null,
      };
    } catch {
      /* First run or unreadable state: start fresh. */
    }
    return store;
  }

  get recent() {
    return this.state.recent;
  }

  get preferences() {
    return this.state.preferences;
  }

  get bounds() {
    return this.state.bounds;
  }

  set bounds(value: Bounds | null) {
    this.state.bounds = value;
    this.save();
  }

  remember(location: Location, name: string) {
    this.state.recent = [
      { location, name, openedAt: Date.now() },
      ...this.state.recent.filter((r) => !sameLocation(r.location, location)),
    ].slice(0, 20);
    this.save();
  }

  forget(location: Location) {
    this.state.recent = this.state.recent.filter((r) => !sameLocation(r.location, location));
    this.save();
  }

  setPreferences(value: Partial<Preferences>) {
    const next = { ...this.state.preferences };
    if (value.theme && ["system", "light", "dark"].includes(value.theme)) next.theme = value.theme;
    if (typeof value.reopenLast === "boolean") next.reopenLast = value.reopenLast;
    if (typeof value.autoSyncContent === "boolean") next.autoSyncContent = value.autoSyncContent;
    if (typeof value.plantumlServer === "string") {
      const server = value.plantumlServer.trim().replace(/\/+$/, "");
      if (server && !/^https?:\/\/[^\s]+$/i.test(server))
        throw new Error("The PlantUML server must be an http(s) URL.");
      next.plantumlServer = server;
    }
    this.state.preferences = next;
    this.save();
    return next;
  }

  private save() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), 300);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(this.state, null, 2));
  }
}
