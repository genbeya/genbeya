/** Resetting the current branch to a commit, undoing the last commit, and undoing either right afterwards. */
import { Injectable, inject } from "@angular/core";
import type { Commit, ResetMode, ResetResult } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { UnsavedChanges } from "../../core/unsaved-changes";
import { WorkspaceApi } from "../../core/workspace-api";
import type { ResetRequest } from "./reset-dialog";

@Injectable({ providedIn: "root" })
export class ResetActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);
  private readonly unsaved = inject(UnsavedChanges);

  /** Asks what to keep, then moves the current branch to `commit`, offering to undo it. */
  async resetTo(commit: Commit): Promise<void> {
    const plan = await this.session.run(() => this.api.versionControl.resetPlan(commit.hash));
    if (!plan) return;
    const { ResetDialog } = await import("./reset-dialog");
    const mode = await this.dialogs.open<ResetMode, ResetRequest>(ResetDialog, {
      plan,
      at: `${commit.hash.slice(0, 7)} ${commit.subject}`,
    });
    // Hard and keep rewrite files, and with them what editors have not saved.
    if (!mode || ((mode === "hard" || mode === "keep") && !(await this.unsaved.confirmDiscard()))) return;
    const result = await this.session.run(() => this.api.versionControl.reset(plan.target, mode, plan.head));
    if (!result) return;
    // Undoing brings back the commits, never the uncommitted changes a hard reset discarded: Undo would promise too much.
    const undoable = mode !== "hard" || !plan.uncommitted.length;
    this.notifications.success(
      `Reset ${plan.branch} to ${plan.target.slice(0, 7)}`,
      undoable ? { label: "Undo", run: () => this.undo(result, mode) } : undefined,
    );
  }

  /** Takes the last commit off the current branch, keeping its changes staged; asks first when it was pushed. */
  async undoLastCommit(): Promise<void> {
    const head = this.session.snapshot()?.head;
    if (!head?.branch) return this.notifications.error("Switch to a branch first.");
    // Nothing ahead: the upstream has the last commit.
    if (head.upstream && !head.ahead) {
      const confirmed = await this.dialogs.confirm({
        title: "Undo a pushed commit",
        message: `The last commit is already on ${head.upstream}. Afterwards ${head.branch} is behind it; removing the commit there as well takes a force push.`,
        confirm: "Undo commit",
      });
      if (!confirmed) return;
    }
    const result = await this.session.run(() => this.api.versionControl.undoLastCommit());
    if (result)
      this.notifications.success("Undid the last commit; its changes are staged", { label: "Redo", run: () => this.undo(result, "soft") });
  }

  /**
   * Moves the branch back to where a reset took it from. A hard reset is
   * undone with keep, which refuses to overwrite changes made since.
   */
  private undo({ from, to }: ResetResult, mode: ResetMode): Promise<boolean> {
    return this.session.succeeded(() => this.api.versionControl.reset(from, mode === "hard" ? "keep" : mode, to), "Reset undone");
  }
}
