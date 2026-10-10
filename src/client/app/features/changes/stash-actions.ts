/** Stashing changes and getting them back, with the confirmations they need. */
import { Injectable, inject } from "@angular/core";
import { Router } from "@angular/router";
import type { Stash, StashOptions } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";

const CONFLICTS = "The stash conflicts with your changes. Resolve the conflicted files; the stash stays in the list.";

@Injectable({ providedIn: "root" })
export class StashActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);

  /** Asks how, then stashes the uncommitted changes. Resolves to true when they were stashed. */
  async create(): Promise<boolean> {
    const { StashDialog } = await import("./stash-dialog");
    const options = await this.dialogs.open<StashOptions>(StashDialog);
    if (!options) return false;
    return this.session.succeeded(() => this.api.versionControl.stash(options), "Changes stashed");
  }

  async apply(stash: Stash, pop: boolean): Promise<void> {
    const outcome = await this.session.run(() => this.api.versionControl.applyStash(stash.hash, pop));
    if (outcome === "done") {
      this.notifications.success(pop ? "Stash popped" : "Stash applied");
      if (pop) this.leave(stash);
    } else if (outcome === "stopped") this.notifications.error(CONFLICTS);
  }

  async drop(stash: Stash): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: "Drop stash",
      message: `Drop "${stash.message}"? Its changes are lost.`,
      confirm: "Drop",
      danger: true,
    });
    if (!confirmed) return;
    if (await this.session.succeeded(() => this.api.versionControl.dropStash(stash.hash), "Stash dropped")) this.leave(stash);
  }

  async branch(stash: Stash): Promise<void> {
    const name = await this.dialogs.prompt({
      title: "Branch from stash",
      label: "Branch name",
      placeholder: "feature/my-change",
      confirm: "Create and switch",
      hint: "Starts at the commit the stash was made on, applies the stash there and drops it.",
    });
    if (!name) return;
    if (await this.session.succeeded(() => this.api.versionControl.branchFromStash(stash.hash, name), `Switched to ${name}`))
      this.leave(stash);
  }

  /** The stash is gone; show the changes instead. */
  private leave(stash: Stash) {
    if (this.router.url.includes(stash.hash)) void this.router.navigate(["/changes"], { replaceUrl: true });
  }
}
