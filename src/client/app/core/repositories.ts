/**
 * Recently opened repositories and where new ones can come from: the
 * folder picker, the WSL distributions of this machine, and the folders on
 * WSL and SSH.
 */
import { effect, Injectable, inject, signal } from "@angular/core";
import type { FolderListing, Location, RecentEntry, RemoteLocation } from "../../../contracts/model";
import { MANAGERS, SHELL } from "../platform/platform";
import { Notifications } from "./notifications";
import { Session } from "./session";

@Injectable({ providedIn: "root" })
export class Repositories {
  private readonly managers = inject(MANAGERS);
  private readonly shell = inject(SHELL);
  private readonly notifications = inject(Notifications);
  private readonly list = signal<readonly RecentEntry[]>([]);
  /** Most recent first; follows every repository switch. */
  readonly recent = this.list.asReadonly();

  constructor() {
    const session = inject(Session);
    effect(() => {
      session.id();
      void this.refresh();
    });
  }

  async forget(location: Location): Promise<void> {
    try {
      await this.managers.workspace.forget(location);
    } catch (error) {
      this.notifications.error(error);
    }
    await this.refresh();
  }

  /** WSL distributions; none where WSL is missing. */
  distributions(): Promise<readonly string[]> {
    return this.managers.workspace.distributions().catch(() => []);
  }

  pickFolder(): Promise<Location | null> {
    return this.shell.pickFolder();
  }

  /** The subfolders of a folder on WSL or SSH; an empty path is the home folder. Rejects with a message to show. */
  browse(location: RemoteLocation): Promise<FolderListing> {
    return this.managers.workspace.browse(location);
  }

  private async refresh() {
    try {
      this.list.set(await this.managers.workspace.recent());
    } catch (error) {
      this.notifications.error(error);
    }
  }
}
