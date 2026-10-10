/** Merges and the operations that can stop for conflicts: starting them, and continuing, skipping or aborting them. */
import { Injectable, inject } from "@angular/core";
import { Router } from "@angular/router";
import type { MergeOptions, OperationKind, OperationOutcome } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import type { MergeRequest } from "./merge-dialog";

const NAMES: Readonly<Record<OperationKind, string>> = { merge: "Merge", rebase: "Rebase", "cherry-pick": "Cherry-pick", revert: "Revert" };

@Injectable({ providedIn: "root" })
export class OperationActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);
  private readonly router = inject(Router);

  /** Asks for the message and whether to fast-forward, then merges `source` into the current branch. */
  async merge(source: string, kind: MergeRequest["kind"]): Promise<void> {
    const target = this.session.snapshot()?.head.branch;
    if (!target) return this.notifications.error("Switch to a branch to merge into first.");
    const { MergeDialog } = await import("./merge-dialog");
    const options = await this.dialogs.open<MergeOptions, MergeRequest>(MergeDialog, { source, kind, target });
    if (!options) return;
    this.report(await this.session.run(() => this.api.versionControl.merge(source, options)), `Merged ${source} into ${target}`);
  }

  async continue(): Promise<void> {
    const name = this.name();
    this.report(await this.session.run(() => this.api.versionControl.continueOperation()), `${name} finished`);
  }

  async skip(): Promise<void> {
    const name = this.name();
    this.report(await this.session.run(() => this.api.versionControl.skipOperation()), `${name} finished`);
  }

  async abort(): Promise<void> {
    const name = this.name();
    const confirmed = await this.dialogs.confirm({
      title: `Abort ${name.toLowerCase()}`,
      message: "Everything goes back to how it was before it started. Conflict resolutions made so far are lost.",
      confirm: "Abort",
      danger: true,
    });
    if (confirmed) await this.session.succeeded(() => this.api.versionControl.abortOperation(), `${name} aborted`);
  }

  /** Reports a finished operation; one that stopped shows its conflicts, with the banner to continue. */
  report(outcome: OperationOutcome | undefined, done: string): void {
    if (outcome === "done") this.notifications.success(done);
    else if (outcome === "stopped") void this.router.navigate(["/changes"]);
  }

  private name(): string {
    const kind = this.session.snapshot()?.operation?.kind;
    return kind ? NAMES[kind] : "Operation";
  }
}
