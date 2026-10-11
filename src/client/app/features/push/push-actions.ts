/** Pushing branches: to their upstream, publishing them, to any remote branch, and force pushing with a lease. */
import { Injectable, inject } from "@angular/core";
import type { PushRequest, Remote } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import type { ForcePushConfirmation, ForcePushRequest } from "./force-push-dialog";
import type { PushChoice, PushDialogRequest } from "./push-dialog";

type Target = Omit<PushRequest, "force">;

/** A remote-tracking branch such as `origin/feature` as its remote and the branch there; remote names may hold slashes. */
export function splitRemoteBranch(name: string, remotes: readonly Remote[]): { remote: string; branch: string } | null {
  const remote = remotes
    .map((candidate) => candidate.name)
    .filter((candidate) => name.startsWith(`${candidate}/`))
    .sort((a, b) => b.length - a.length)[0];
  return remote ? { remote, branch: name.slice(remote.length + 1) } : null;
}

/** The remote a branch without upstream is published to: origin, or the only remote. Null when the user has to choose. */
export function publishRemote(remotes: readonly Remote[]): string | null {
  return remotes.find((remote) => remote.name === "origin")?.name ?? (remotes.length === 1 ? remotes[0]!.name : null);
}

@Injectable({ providedIn: "root" })
export class PushActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);

  /** Pushes the current branch to its upstream; one without upstream is published, with the remote branch as its upstream. */
  async push(): Promise<void> {
    const snapshot = this.session.snapshot();
    const branch = snapshot?.head.branch;
    if (!snapshot || !branch) return this.notifications.error("Switch to a branch first.");
    if (snapshot.head.upstream) {
      const upstream = splitRemoteBranch(snapshot.head.upstream, snapshot.remotes);
      if (upstream) return this.send({ branch, remote: upstream.remote, remoteBranch: upstream.branch, setUpstream: false });
    } else {
      const remote = publishRemote(snapshot.remotes);
      if (remote) return this.send({ branch, remote, remoteBranch: branch, setUpstream: true }, `Published ${branch} to ${remote}`);
    }
    return this.pushTo(branch);
  }

  /** Asks where to push `branch` (the current one unless given), then pushes it there, force pushing if chosen. */
  async pushTo(branch = this.session.snapshot()?.head.branch ?? null): Promise<void> {
    if (!branch) return this.notifications.error("Switch to a branch first.");
    const plan = await this.session.run(() => this.api.versionControl.pushPlan(branch));
    if (!plan) return;
    if (!plan.remotes.length) return this.notifications.error("Add a remote to push to first.");
    const { PushDialog } = await import("./push-dialog");
    const choice = await this.dialogs.open<PushChoice, PushDialogRequest>(PushDialog, { plan });
    if (!choice) return;
    const { force, ...target } = choice;
    await (force ? this.forcePush({ branch, ...target }) : this.send({ branch, ...target }));
  }

  /** Shows the commits a force push removes from the remote branch, then replaces it if it is still where the last fetch saw it. */
  async forcePush(target: Target): Promise<void> {
    const { branch, remote, remoteBranch } = target;
    const plan = await this.session.run(() => this.api.versionControl.forcePushPlan(branch, remote, remoteBranch));
    if (!plan) return;
    const { ForcePushDialog } = await import("./force-push-dialog");
    const confirmation = await this.dialogs.open<ForcePushConfirmation, ForcePushRequest>(ForcePushDialog, {
      plan,
      branch,
      remote,
      remoteBranch,
    });
    if (!confirmation) return;
    const force = { expected: plan.expected, defaultBranch: confirmation.defaultBranch };
    await this.send({ ...target, force }, `Force pushed ${branch} to ${remote}/${remoteBranch}`);
  }

  /** Pushes; a push the remote rejects for commits the branch lacks offers to force push instead. */
  private async send(request: PushRequest, success = `Pushed ${request.branch} to ${request.remote}/${request.remoteBranch}`) {
    const outcome = await this.session.run(() => this.api.versionControl.push(request));
    if (outcome === "done") this.notifications.success(success);
    if (outcome !== "rejected") return;
    // Only pushes that do not force are rejected this way.
    const { branch, remote, remoteBranch, setUpstream } = request;
    this.notifications.error(
      `${remote}/${remoteBranch} has commits that ${branch} lacks, so the push was rejected. ` +
        "Pull to bring them in, or force push to replace them.",
      { label: "Force push with lease…", run: () => this.forcePush({ branch, remote, remoteBranch, setUpstream }) },
    );
  }
}
