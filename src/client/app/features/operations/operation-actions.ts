/**
 * Merges, rebases, cherry-picks and reverts — the operations that can stop
 * for conflicts: starting them, with the confirmations they need, and
 * continuing, skipping or aborting them.
 */
import { Injectable, inject } from "@angular/core";
import { Router } from "@angular/router";
import type { Commit, MergeOptions, OperationKind, OperationOutcome, RebaseStep } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import type { MergeRequest } from "./merge-dialog";
import type { RebaseRequest } from "./rebase-dialog";

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

  /** Rebases the current branch onto `onto` after confirming, warning when the commits were pushed. */
  async rebase(onto: string): Promise<void> {
    const branch = this.session.snapshot()?.head.branch;
    if (!branch) return this.notifications.error("Switch to a branch to rebase first.");
    const plan = await this.session.run(() => this.api.versionControl.rebasePlan(onto));
    if (!plan) return;
    if (!plan.commits.length) return this.notifications.success(`${branch} has no commits that ${onto} lacks`);
    const count = plan.commits.length === 1 ? "its commit" : `its ${plan.commits.length} commits`;
    const confirmed = await this.dialogs.confirm({
      title: `Rebase ${branch} onto ${onto}`,
      message: [
        `${branch} gets ${count} replayed on top of ${onto}.`,
        this.pushedWarning(plan.pushed),
        this.dirty() ? "Your uncommitted changes are stashed meanwhile and put back afterwards." : "",
      ]
        .filter(Boolean)
        .join(" "),
      confirm: "Rebase",
    });
    if (!confirmed) return;
    const dirty = this.dirty();
    this.report(await this.session.run(() => this.api.versionControl.rebase(onto, dirty)), `Rebased ${branch} onto ${onto}`);
  }

  /** Brings the current branch up to date with what it tracks on `remote`, replaying its own commits on top. */
  async pullRebase(remote: string): Promise<void> {
    const dirty = this.dirty();
    this.report(await this.session.run(() => this.api.versionControl.pullRebase(remote, dirty)), `Pulled from ${remote} by rebasing`);
  }

  /** Lets the user rewrite the commits after `base` on the current branch. */
  async rebaseInteractive(base: Commit): Promise<void> {
    const branch = this.session.snapshot()?.head.branch;
    if (!branch) return this.notifications.error("Switch to a branch to rebase first.");
    const plan = await this.session.run(() => this.api.versionControl.rebasePlan(base.hash));
    if (!plan) return;
    if (!plan.commits.length) return this.notifications.error(`${branch} has no commits after ${base.hash.slice(0, 7)}.`);
    if (plan.commits.some((commit) => commit.merge))
      return this.notifications.error(
        "These commits include a merge, which an interactive rebase in GitDesk can't rewrite. Use the terminal instead.",
      );
    const { RebaseDialog } = await import("./rebase-dialog");
    const dirty = this.dirty();
    const steps = await this.dialogs.open<RebaseStep[], RebaseRequest>(RebaseDialog, { plan, branch, dirty });
    if (!steps) return;
    this.report(await this.session.run(() => this.api.versionControl.rebaseInteractive(plan.base, steps, dirty)), `Rebased ${branch}`);
  }

  async cherryPick(commit: Commit): Promise<void> {
    this.report(await this.session.run(() => this.api.versionControl.cherryPick(commit.hash)), `Cherry-picked “${commit.subject}”`);
  }

  async revert(commit: Commit): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: "Revert commit",
      message: `Undo the changes of “${commit.subject}” with a new commit on ${this.session.snapshot()?.head.branch ?? "this checkout"}?`,
      confirm: "Revert",
    });
    if (confirmed) this.report(await this.session.run(() => this.api.versionControl.revert(commit.hash)), `Reverted “${commit.subject}”`);
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

  /** Tracked files have uncommitted changes, which rewriting history must set aside. */
  private dirty(): boolean {
    return !!this.session.snapshot()?.changes.some((change) => change.index !== "?");
  }

  private pushedWarning(pushed: readonly string[]): string {
    return pushed.length ? `Some of these commits are already on ${pushed.join(", ")}: you will have to force-push.` : "";
  }

  private name(): string {
    const kind = this.session.snapshot()?.operation?.kind;
    return kind ? NAMES[kind] : "Operation";
  }
}
