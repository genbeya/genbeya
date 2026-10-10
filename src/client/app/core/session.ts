/**
 * The open repository and everything that changes it: opening, switching
 * and closing repositories, the polled snapshot, the busy state, and the
 * user's preferences.
 */
import { computed, DestroyRef, Injectable, inject, signal } from "@angular/core";
import type { GitdeskLink } from "../../../contracts/gitdesk-link";
import type { Location, Preferences, Snapshot } from "../../../contracts/model";
import { requestedLink, requestedLocation } from "../../../utilities/launch-request";
import { MANAGERS, SHELL } from "../platform/platform";
import { Notifications } from "./notifications";
import { UnsavedChanges } from "./unsaved-changes";

export const POLL_INTERVAL = 4000;
export const CONTENT_SYNC_DELAY = 2500;
const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  reopenLast: true,
  autoSyncContent: false,
  lastSeenVersion: null,
  tourSeen: false,
  tourOffered: [],
};

interface Open {
  readonly id: string;
  readonly snapshot: Snapshot;
}

@Injectable({ providedIn: "root" })
export class Session {
  private readonly managers = inject(MANAGERS);
  private readonly shell = inject(SHELL);
  private readonly notifications = inject(Notifications);
  private readonly unsaved = inject(UnsavedChanges);
  private readonly current = signal<Open | null>(null);
  private readonly pending = signal(0);
  private readonly link = signal<GitdeskLink | null>(null);
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshes = 0;

  readonly phase = signal<"starting" | "idle" | "opening">("starting");
  readonly preferences = signal<Preferences>(DEFAULT_PREFERENCES);
  /** The open repository's id; changes with every open, so its views start fresh. */
  readonly id = computed(() => this.current()?.id ?? null);
  readonly snapshot = computed(() => this.current()?.snapshot ?? null);
  readonly busy = computed(() => this.pending() > 0);
  /** A GitDesk link a launch asked to open, until whoever opens it takes it. */
  readonly requestedLink = this.link.asReadonly();

  constructor() {
    const timer = setInterval(() => void this.poll(), POLL_INTERVAL);
    const focus = () => void this.poll();
    addEventListener("focus", focus);
    const stopSecondLaunch = this.shell.onSecondLaunch((args) => void this.openRequested(args));
    const stopGuard = this.shell.guardClose(() => this.unsaved.any());
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      clearTimeout(this.syncTimer);
      removeEventListener("focus", focus);
      stopSecondLaunch();
      stopGuard();
    });
  }

  /**
   * Loads preferences and reopens the repository the launch or the last
   * session asks for. A GitDesk link among the launch arguments waits in
   * {@link requestedLink}; the managers then reopen nothing, since the link
   * decides the repository.
   */
  async start(): Promise<void> {
    try {
      this.preferences.set(await this.managers.workspace.preferences());
      const args = await this.shell.launchArgs();
      this.accept(await this.managers.workspace.restore(args));
      this.link.set(requestedLink(args) ?? null);
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.phase.set("idle");
    }
  }

  open(location: Location): Promise<void> {
    return this.switchTo(() => this.managers.workspace.open(location));
  }

  /** Lets the user pick a folder, then opens it. */
  async pick(): Promise<void> {
    const location = await this.shell.pickFolder();
    if (location) await this.open(location);
  }

  clone(url: string, parent: Location): Promise<void> {
    return this.switchTo(() => this.managers.workspace.clone(url, parent));
  }

  async close(): Promise<void> {
    const open = this.current();
    if (!open || !(await this.unsaved.confirmDiscard())) return;
    await this.managers.workspace.close(open.id);
    this.current.set(null);
    this.shell.setTitle("GitDesk");
  }

  /** Fetches the snapshot if anything changed. */
  async refresh(): Promise<void> {
    const open = this.current();
    if (!open) return;
    const ticket = ++this.refreshes;
    const next = await this.managers.workspace.snapshot(open.id, open.snapshot.version);
    // A repository switch or a newer refresh while fetching makes the result stale.
    if (next && ticket === this.refreshes && this.current()?.id === open.id) this.current.set({ id: open.id, snapshot: next });
  }

  /**
   * Runs a repository action: marks the session busy, reports failures,
   * and refreshes afterwards. Resolves to undefined when the action failed.
   */
  async run<T>(action: () => Promise<T>, success?: string): Promise<T | undefined> {
    this.pending.update((n) => n + 1);
    try {
      const result = await action();
      if (success) this.notifications.success(success);
      return result;
    } catch (error) {
      this.notifications.error(error);
      return undefined;
    } finally {
      await this.refresh().catch(() => undefined);
      this.pending.update((n) => n - 1);
    }
  }

  /** Call after wiki or task edits: shares them soon when the content branch syncs automatically. */
  contentChanged(): void {
    const storage = this.snapshot()?.storage;
    if (!this.preferences().autoSyncContent || storage?.mode !== "branch" || !storage.remote) return;
    const id = this.id()!;
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => void this.run(() => this.managers.content.syncContent(id)), CONTENT_SYNC_DELAY);
  }

  async setPreferences(change: Partial<Preferences>): Promise<void> {
    try {
      this.preferences.set(await this.managers.workspace.setPreferences(change));
    } catch (error) {
      this.notifications.error(error);
    }
  }

  /** The link a launch asked to open, which the caller now opens; null when there is none. */
  takeRequestedLink(): GitdeskLink | null {
    const link = this.link();
    this.link.set(null);
    return link;
  }

  private async poll() {
    if (!document.hidden) await this.refresh().catch(() => undefined);
  }

  /** A second launch asks to open a GitDesk link, or a repository (the jump list) that the manager validates. */
  private async openRequested(args: readonly string[]) {
    const link = requestedLink(args);
    if (link) return this.link.set(link);
    const location = requestedLocation(args);
    if (location !== undefined) await this.open(location as Location);
  }

  /** Every repository switch asks before discarding unsaved edits. */
  private async switchTo(opening: () => Promise<Open | null>): Promise<void> {
    if (!(await this.unsaved.confirmDiscard())) return;
    this.phase.set("opening");
    try {
      this.accept(await opening());
    } catch (error) {
      this.notifications.error(error);
    } finally {
      this.phase.set("idle");
    }
  }

  private accept(opened: Open | null) {
    if (!opened) return;
    this.current.set(opened);
    this.shell.setTitle(`${opened.snapshot.settings.name} — GitDesk`);
  }
}
