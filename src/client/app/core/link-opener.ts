/**
 * Opens the item a Genbeya link names: in the open repository when it has
 * the link's remote, else in a recent repository that had it. Remote URLs
 * match in any form (https or ssh, with or without user name and `.git`).
 * Links only ever show an item; they run nothing.
 */
import { ApplicationRef, Injectable, inject } from "@angular/core";
import { Router } from "@angular/router";
import type { GenbeyaLink, LinkItem } from "../../../contracts/genbeya-link";
import { sameLocation, type RecentEntry } from "../../../contracts/model";
import { sameRepository } from "../../../utilities/remote-url";
import { MANAGERS } from "../platform/platform";
import { Session } from "./session";

/** The view and query parameters that show an item. */
function route(item: LinkItem): [string, Record<string, string>] {
  switch (item.kind) {
    case "page":
      return ["/wiki", { page: item.path }];
    case "task":
      return ["/tasks", { task: item.id }];
    case "file":
      return ["/code", { file: item.path }];
    case "commit":
      return ["/history", { commit: item.hash }];
  }
}

@Injectable({ providedIn: "root" })
export class LinkOpener {
  private readonly session = inject(Session);
  private readonly managers = inject(MANAGERS);
  private readonly router = inject(Router);
  private readonly app = inject(ApplicationRef);

  /** Resolves to false when no repository Genbeya knows has the link's remote. */
  async open({ remote, item }: GenbeyaLink): Promise<boolean> {
    const matches = (urls: readonly string[]) => urls.some((url) => sameRepository(url, remote));
    const open = this.session.snapshot();
    if (!open || !matches(open.remotes.map((candidate) => candidate.url))) {
      const recent: readonly RecentEntry[] = await this.managers.workspace.recent().catch(() => []);
      const entry = recent.find((candidate) => !(open && sameLocation(candidate.location, open.location)) && matches(candidate.remotes));
      if (!entry) return false;
      await this.session.open(entry.location);
      // The user kept unsaved edits, or the repository failed to open (and that was reported).
      const opened = this.session.snapshot();
      if (!opened || !sameLocation(opened.location, entry.location)) return true;
    }
    // A repository that just opened (here, or by cloning) starts on its wiki; show the item once it has.
    await this.app.whenStable();
    const [view, queryParams] = route(item);
    await this.router.navigate([view], { queryParams });
    return true;
  }
}
