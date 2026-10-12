/** Branches and tags from the history: creating them at a commit, renaming, deleting, upstreams and remotes. */
import { Injectable, inject } from "@angular/core";
import type { Commit } from "../../../../contracts/model";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { RepositoryActions } from "../shell/repository-actions";
import type { NewRef, RefDialogOptions } from "./ref-dialog";

const describe = (commit: Commit) => `${commit.hash.slice(0, 7)} ${commit.subject}`;

@Injectable({ providedIn: "root" })
export class RefActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);
  private readonly repository = inject(RepositoryActions);

  // A name Git refuses, or one that exists, is reported in the dialog, which stays open to correct it.

  async createBranch(commit: Commit): Promise<void> {
    await this.ask({
      kind: "branch",
      at: describe(commit),
      accept: (branch) =>
        this.session.attempt(
          () => this.api.versionControl.createBranch(branch.name, commit.hash, branch.checkout),
          branch.checkout ? `Switched to ${branch.name}` : `Created ${branch.name}`,
        ),
    });
  }

  async createTag(commit: Commit): Promise<void> {
    await this.ask({
      kind: "tag",
      at: describe(commit),
      accept: (tag) =>
        this.session.attempt(() => this.api.versionControl.createTag(tag.name, commit.hash, tag.message), `Tagged ${tag.name}`),
    });
  }

  async renameBranch(name: string): Promise<void> {
    await this.dialogs.prompt({
      title: "Rename branch",
      label: "New name",
      initial: name,
      confirm: "Rename",
      accept: async (newName) =>
        newName === name ? null : this.session.attempt(() => this.api.versionControl.renameBranch(name, newName), `Renamed to ${newName}`),
    });
  }

  /** Asks first, and again with a warning when the branch has commits no other branch has. */
  async deleteBranch(name: string): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: "Delete branch",
      message: `Delete the branch ${name}? Its commits stay reachable from other branches that contain them.`,
      confirm: "Delete",
      danger: true,
    });
    if (!confirmed) return;
    const deleted = await this.session.run(() => this.api.versionControl.deleteBranch(name, false));
    if (deleted) this.notifications.success(`Deleted ${name}`);
    if (deleted !== false) return;
    const force = await this.dialogs.confirm({
      title: "Branch not fully merged",
      message: `${name} has commits that are not on its upstream or the current branch. Deleting it may lose them. Delete anyway?`,
      confirm: "Delete anyway",
      danger: true,
    });
    if (force) await this.session.succeeded(() => this.api.versionControl.deleteBranch(name, true), `Deleted ${name}`);
  }

  async deleteRemoteBranch(name: string): Promise<void> {
    const slash = name.indexOf("/");
    const confirmed = await this.dialogs.confirm({
      title: "Delete remote branch",
      message: `Delete ${name.slice(slash + 1)} on ${name.slice(0, slash)}? Everyone who uses the remote loses the branch.`,
      confirm: "Delete on remote",
      danger: true,
    });
    if (confirmed) await this.session.succeeded(() => this.api.versionControl.deleteRemoteBranch(name), `Deleted ${name}`);
  }

  async setUpstream(branch: string): Promise<void> {
    const remotes = this.session.snapshot()?.remotes ?? [];
    const upstream = await this.dialogs.prompt({
      title: "Set upstream",
      label: "Remote branch",
      initial: `${remotes[0]?.name ?? "origin"}/${branch}`,
      confirm: "Set upstream",
      hint: `Pull and push of ${branch} go to this branch. Fetch first if the remote has it but Genbeya does not list it yet.`,
    });
    if (upstream) await this.session.succeeded(() => this.api.versionControl.setUpstream(branch, upstream), `${branch} tracks ${upstream}`);
  }

  async deleteTag(name: string): Promise<void> {
    const confirmed = await this.dialogs.confirm({
      title: "Delete tag",
      message: `Delete the tag ${name} in this repository? Remotes keep their copy.`,
      confirm: "Delete",
      danger: true,
    });
    if (confirmed) await this.session.succeeded(() => this.api.versionControl.deleteTag(name), `Deleted ${name}`);
  }

  async pushTag(name: string): Promise<void> {
    const remote = this.repository.remote();
    if (remote) await this.session.succeeded(() => this.api.versionControl.pushTag(name, remote), `Pushed ${name} to ${remote}`);
  }

  async deleteRemoteTag(name: string): Promise<void> {
    const remote = this.repository.remote();
    if (!remote) return;
    const confirmed = await this.dialogs.confirm({
      title: "Delete remote tag",
      message: `Delete the tag ${name} on ${remote}? Everyone who uses the remote loses it.`,
      confirm: "Delete on remote",
      danger: true,
    });
    if (confirmed)
      await this.session.succeeded(() => this.api.versionControl.deleteRemoteTag(name, remote), `Deleted ${name} on ${remote}`);
  }

  private async ask(options: RefDialogOptions): Promise<NewRef | undefined> {
    const { RefDialog } = await import("./ref-dialog");
    return this.dialogs.open<NewRef, RefDialogOptions>(RefDialog, options);
  }
}
