/** Branch and remote actions shared by the sidebar, the palette and the changes view. */
import { Injectable, inject } from "@angular/core";
import type { SyncAction } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";

const SYNC_RESULT: Record<SyncAction, string> = { fetch: "Fetched", pull: "Pulled", push: "Pushed" };

@Injectable({ providedIn: "root" })
export class RepositoryActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);

  /** The remote the current branch tracks, else the first one. */
  remote(): string | null {
    const snapshot = this.session.snapshot();
    return snapshot?.head.upstream?.split("/")[0] ?? snapshot?.remotes[0]?.name ?? null;
  }

  switchBranch(name: string): Promise<unknown> {
    // Remote-only branches become local tracking branches.
    const label = this.session.snapshot()?.remoteBranches.includes(name)
      ? `Checked out ${name.slice(name.indexOf("/") + 1)}`
      : `Switched to ${name}`;
    return this.session.run(() => this.api.versionControl.switchBranch(name), label);
  }

  async createBranch(initial = ""): Promise<void> {
    const name = await this.dialogs.prompt({
      title: "Create branch",
      label: "Branch name",
      initial,
      placeholder: "feature/my-change",
      confirm: "Create and switch",
      hint: "Starts from the current commit. Uncommitted changes come along.",
    });
    if (name) await this.session.run(() => this.api.versionControl.createBranch(name), `Switched to ${name}`);
  }

  sync(action: SyncAction, remote: string): Promise<unknown> {
    return this.session.run(() => this.api.versionControl.sync(action, remote), SYNC_RESULT[action]);
  }

  syncContent(): Promise<unknown> {
    return this.session.run(() => this.api.content.syncContent(), "The content branch is in sync");
  }
}
