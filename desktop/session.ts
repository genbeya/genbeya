/**
 * The desktop API without Electron: what electron/ipc.ts does, written
 * against a small Platform interface so the Deno and Tauri shells can share
 * it. Workspace calls carry a token, as over Electron IPC, so calls racing a
 * repository switch fail instead of touching the newly opened repository.
 */
import path from "node:path";
import type { Location, Preferences, RecentEntry, Snapshot, WorkspaceAPI } from "../shared/api.js";
import { createHost, fromWindowsPath, validateLocation, wslDistros } from "../core/hosts.js";
import { Workspace } from "../core/workspace.js";
import { renderPlantUml } from "../electron/plantuml.js";
import type { Store } from "../electron/state.js";
import { DESKTOP_METHODS, OPENING_METHODS, WORKSPACE_METHODS } from "./methods.js";

export interface Platform {
  /** An absolute folder path, or null when cancelled. */
  pickFolder(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  setTitle(title: string): void;
  setTheme(theme: Preferences["theme"]): void;
  recentChanged(recent: RecentEntry[]): void;
  fetch: typeof fetch;
  argv: string[];
}

const FLAG = "--open=";

/** The repository passed with `--open=…` (from the jump list), if any. */
export function locationFromArgs(argv: string[]): Location | null {
  const arg = argv.find((a) => a.startsWith(FLAG));
  if (!arg) return null;
  try {
    return validateLocation(JSON.parse(Buffer.from(arg.slice(FLAG.length), "base64url").toString("utf8")));
  } catch {
    return null;
  }
}

type Opened = { token: string; snapshot: Snapshot } | null;

export class DesktopSession {
  private workspace: Workspace | null = null;
  private token: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly platform: Platform,
  ) {
    platform.setTheme(store.preferences.theme);
    platform.recentChanged(store.recent);
  }

  /** Runs a workspace method for the repository the token was issued for. */
  call(method: string, token: unknown, args: unknown[]) {
    const current = this.workspace;
    if (!(WORKSPACE_METHODS as string[]).includes(method)) throw new Error(`Unknown method ${method}.`);
    if (!current || token !== this.token) throw new Error("This repository is no longer open.");
    return current.exclusive(() =>
      (current[method as keyof WorkspaceAPI] as (...a: unknown[]) => Promise<unknown>)(...args),
    );
  }

  private async activate(location: Location): Promise<Opened> {
    const next = await Workspace.open(location);
    let snapshot;
    try {
      snapshot = (await next.snapshot())!;
    } catch (error) {
      next.dispose();
      throw error;
    }
    this.workspace?.dispose();
    this.workspace = next;
    this.token = crypto.randomUUID();
    this.store.remember(location, snapshot.settings.name);
    this.platform.recentChanged(this.store.recent);
    this.platform.setTitle(`${snapshot.settings.name} — GitDesk`);
    return { token: this.token, snapshot };
  }

  async pickFolder() {
    const folder = await this.platform.pickFolder();
    return folder ? fromWindowsPath(folder) : null;
  }

  open(location: unknown) {
    return this.activate(validateLocation(location));
  }

  async restore(): Promise<Opened> {
    // A renderer reload keeps the open repository.
    const current = this.workspace;
    if (current) {
      this.token = crypto.randomUUID();
      return { token: this.token, snapshot: (await current.exclusive(() => current.snapshot()))! };
    }
    const requested = locationFromArgs(this.platform.argv);
    if (requested) return this.activate(requested).catch(() => null);
    const last = this.store.recent[0];
    if (!this.store.preferences.reopenLast || !last) return null;
    return this.activate(last.location).catch(() => null);
  }

  async clone(url: unknown, parent: unknown) {
    if (typeof url !== "string" || !url.trim() || url.length > 2048 || url.trim().startsWith("-") || /[\r\n\0]/.test(url))
      throw new Error("Enter a Git URL or repository path.");
    const where = validateLocation(parent);
    const name =
      path.posix
        .basename(url.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/"))
        .replace(/\.git$/, "")
        .replace(/[^A-Za-z0-9._-]/g, "-") || "repository";
    const host = createHost(where);
    try {
      const result = await host.run("git", ["clone", "--", url.trim(), name], { cwd: where.path, timeout: 15 * 60_000 });
      if (result.code !== 0) throw new Error(result.stderr.replace(/^fatal: /gm, "").trim());
    } finally {
      host.dispose();
    }
    return this.activate({ ...where, path: where.kind === "local" ? path.join(where.path, name) : path.posix.join(where.path, name) });
  }

  close() {
    this.workspace?.dispose();
    this.workspace = null;
    this.token = null;
    this.platform.setTitle("GitDesk");
  }

  recent() {
    return this.store.recent;
  }

  forget(location: unknown) {
    this.store.forget(validateLocation(location));
    this.platform.recentChanged(this.store.recent);
  }

  wslDistros() {
    return wslDistros();
  }

  preferences() {
    return this.store.preferences;
  }

  setPreferences(value: unknown) {
    const preferences = this.store.setPreferences((value ?? {}) as object);
    this.platform.setTheme(preferences.theme);
    return preferences;
  }

  plantuml(source: unknown) {
    return renderPlantUml(source as string, this.store.preferences.plantumlServer, this.platform.fetch);
  }

  async openExternal(url: unknown) {
    if (typeof url !== "string" || !/^(https?:|mailto:)/i.test(url)) throw new Error("Only web and mail links open externally.");
    await this.platform.openExternal(url);
  }

  rootPath(token: unknown, scope: unknown) {
    if (!this.workspace || token !== this.token) throw new Error("This repository is no longer open.");
    return this.workspace.rootPath(scope as "repo" | "content");
  }

  dispose() {
    this.workspace?.dispose();
    return this.store.flush();
  }
}

/** The single entry point a shell exposes to the renderer (see desktop/renderer-api.ts). */
export function handle(session: DesktopSession, method: string, args: unknown[]) {
  if (method === "workspace") {
    const [name, token, ...rest] = args;
    return session.call(name as string, token, rest);
  }
  if (method === "rootPath") return session.rootPath(args[0], args[1]);
  if (method === "close" || (OPENING_METHODS as readonly string[]).includes(method) || (DESKTOP_METHODS as readonly string[]).includes(method))
    return (session as any)[method](...args);
  throw new Error(`Unknown method ${method}.`);
}
