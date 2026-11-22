/**
 * What can be done to a pull request: opening one, editing its fields and
 * its file, replying and giving verdicts, and merging it. Every edit is a
 * save of the file on the version that was shown, so edits made meanwhile,
 * by hand or by someone else, are never overwritten.
 */
import { Injectable, inject } from "@angular/core";
import { Router } from "@angular/router";
import { isDefaultBranch, type PullInput, type PullRequest, type PullStatus } from "../../../../contracts/model";
import { timestampOf } from "../../../../utilities/timestamps";
import type { NewReply, Verdict } from "../../../../utilities/pull-requests";
import { Dialogs } from "../../core/dialogs";
import { Notifications } from "../../core/notifications";
import { People } from "../../core/people";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import type { PullDialogData } from "./pull-dialog";

/** The fields of a pull request, to save it with some of them changed. */
export const pullInputOf = (pull: PullRequest): PullInput => ({
  title: pull.title,
  status: pull.status,
  source: pull.source,
  target: pull.target,
  reviewers: pull.reviewers,
  body: pull.body,
  mergeCommit: pull.mergeCommit,
});

@Injectable({ providedIn: "root" })
export class PullActions {
  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly dialogs = inject(Dialogs);
  private readonly notifications = inject(Notifications);
  private readonly people = inject(People);
  private readonly router = inject(Router);
  private signer: Promise<string> | null = null;

  /** The name replies and verdicts are signed with: the Git user name, as for task comments. */
  author(): Promise<string> {
    this.signer ??= this.api.content.commentAuthor().catch((error: unknown) => {
      this.signer = null;
      throw error;
    });
    return this.signer;
  }

  /** A reply by the user, written now. */
  async reply(text: string, verdict: Verdict | null = null): Promise<NewReply> {
    return { author: await this.author(), date: timestampOf(new Date()), text, verdict };
  }

  private dialogData(pull?: PullRequest): PullDialogData {
    const { branches, remoteBranches, head } = this.session.snapshot()!;
    const all = [...branches, ...remoteBranches];
    // From the current branch into the default branch; from another branch when on the default one.
    const main = branches.find((branch) => isDefaultBranch(branch, null)) ?? branches[0];
    const source = head.branch && head.branch !== main ? head.branch : all.find((branch) => branch !== main);
    return {
      pull,
      branches: pull && !all.includes(pull.source) ? [pull.source, ...all] : all,
      source,
      target: main,
      people: this.people.list().map((person) => person.name),
    };
  }

  /** Asks for the branches, title and reviewers of a new pull request, opens it and shows it. */
  async create(): Promise<void> {
    const { PullDialog } = await import("./pull-dialog");
    const input = await this.dialogs.open<PullInput, PullDialogData>(PullDialog, this.dialogData());
    if (!input) return;
    const pull = await this.session.run(() => this.api.content.createPull(input));
    if (!pull) return;
    this.session.contentChanged();
    await this.router.navigate(["/pulls"], { queryParams: { pull: pull.id } });
  }

  /** Asks for new branches, title and reviewers. */
  async edit(pull: PullRequest): Promise<void> {
    const { PullDialog } = await import("./pull-dialog");
    const input = await this.dialogs.open<PullInput, PullDialogData>(PullDialog, this.dialogData(pull));
    if (input) await this.save(pull, { ...input, body: pull.body, mergeCommit: pull.mergeCommit });
  }

  /** Saves `input` over the version of the file that `pull` was read from; the saved pull request, or undefined when that failed. */
  async save(pull: PullRequest, input: PullInput, success?: string): Promise<PullRequest | undefined> {
    const saved = await this.session.run(() => this.api.content.updatePull(pull.path, input, pull.hash), success);
    if (saved) this.session.contentChanged();
    return saved;
  }

  /** Saves the body `edit` makes of the pull request's; a refused edit (the text moved on) is reported. */
  async editBody(pull: PullRequest, edit: (body: string) => string, success?: string): Promise<PullRequest | undefined> {
    let body: string;
    try {
      body = edit(pull.body);
    } catch (error) {
      this.notifications.error(error);
      return undefined;
    }
    return this.save(pull, { ...pullInputOf(pull), body }, success);
  }

  setStatus(pull: PullRequest, status: PullStatus, success: string): Promise<PullRequest | undefined> {
    return this.save(pull, { ...pullInputOf(pull), status }, success);
  }

  /**
   * Merges the pull request with the merges Genbeya has: switches to the
   * target, merges the source with a merge commit, and records the merge in
   * the file. A merge that stops for conflicts is finished in Changes; the
   * pull request is then marked merged by hand.
   */
  async merge(pull: PullRequest): Promise<void> {
    const snapshot = this.session.snapshot()!;
    const switching = snapshot.head.branch !== pull.target;
    const confirmed = await this.dialogs.confirm({
      title: `Merge ${pull.id}`,
      message: [
        switching ? `Genbeya switches to ${pull.target} first.` : "",
        `${pull.source} is merged into ${pull.target} with a merge commit, and ${pull.id} is marked merged.`,
        "Push afterwards to share it.",
      ]
        .filter(Boolean)
        .join(" "),
      confirm: "Merge",
    });
    if (!confirmed) return;
    if (switching && !(await this.session.succeeded(() => this.api.versionControl.switchBranch(pull.target)))) return;
    const message = `Merge ${pull.id}: ${pull.title}`;
    const outcome = await this.session.run(() => this.api.versionControl.merge(pull.source, { noFastForward: true, message }));
    if (outcome === "stopped") {
      this.notifications.error(`The merge stopped for conflicts. Resolve them in Changes, then mark ${pull.id} merged.`);
      await this.router.navigate(["/changes"]);
      return;
    }
    if (outcome !== "done") return;
    await this.markMerged(pull.id);
  }

  /** Records `status: merged` with the commit the target is at now. */
  async markMerged(id: string): Promise<void> {
    // The file may have changed with the merge (in the checkout it comes along from the source branch).
    const pull = this.session.snapshot()?.pulls.find((candidate) => candidate.id === id);
    if (!pull) return this.notifications.error(`${id} is not in the pull request folder any more.`);
    const compared = await this.session.run(() => this.api.versionControl.compare(pull.target, pull.target, []));
    const mergeCommit = compared?.head ?? null;
    await this.save(pull, { ...pullInputOf(pull), status: "merged", mergeCommit }, `Merged ${pull.id}`);
  }
}
