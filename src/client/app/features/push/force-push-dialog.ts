import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { ForcePushPlan } from "../../../../contracts/model";
import { DialogFrame } from "../../ui/dialog-frame";
import { relativeTime } from "../../ui/relative-time";

export interface ForcePushRequest {
  readonly plan: ForcePushPlan;
  readonly branch: string;
  readonly remote: string;
  readonly remoteBranch: string;
}

/** The user agrees to replace the remote branch; `defaultBranch` when it is the remote's default branch, too. */
export interface ForcePushConfirmation {
  readonly defaultBranch: boolean;
}

/**
 * Confirms a force push: lists the commits the remote branch loses, which
 * everyone else loses with it, and asks once more for the remote's default
 * branch.
 */
@Component({
  selector: "gd-force-push-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./force-push-dialog.css",
  template: `
    <gd-dialog-frame [title]="'Force push to ' + target" [width]="540" (submitted)="submit()">
      @if (plan.total) {
        <p class="dialog-message">
          {{ plan.total === 1 ? "This commit is" : "These " + plan.total + " commits are" }} on {{ target }} but not on
          {{ request.branch }}. The force push removes {{ plan.total === 1 ? "it" : "them" }} from {{ target }}, for everyone who uses
          {{ request.remote }}.
        </p>
        <ul class="force-push-commits" aria-label="Commits the remote branch loses">
          @for (commit of plan.removed; track commit.hash) {
            <li>
              <span class="mono faint">{{ commit.hash.slice(0, 7) }}</span>
              <span class="ellipsis" [title]="commit.subject">{{ commit.subject }}</span>
              <span class="faint ellipsis">{{ commit.author }} · {{ relativeTime(commit.date) }}</span>
            </li>
          }
          @if (plan.total > plan.removed.length) {
            <li class="faint">and {{ plan.total - plan.removed.length }} more</li>
          }
        </ul>
      } @else if (plan.expected) {
        <p class="dialog-message">{{ target }} has no commits that {{ request.branch }} lacks: nothing is removed from it.</p>
      } @else {
        <p class="dialog-message">Your last fetch saw no branch {{ target }}: the push creates it, and fails if it appeared since.</p>
      }
      @if (plan.expected) {
        <p class="dialog-hint">
          The push only goes through while {{ target }} is still at {{ plan.expected.slice(0, 7) }}, where your last fetch saw it.
        </p>
      }
      @if (plan.defaultBranch) {
        <p class="dialog-warning is-danger">
          {{ request.remoteBranch }} is the default branch of {{ request.remote }}: everyone starts from it.
        </p>
        <label class="checkbox">
          <input #know type="checkbox" [checked]="defaultBranch()" (change)="defaultBranch.set(know.checked)" />
          I know, rewrite {{ request.remoteBranch }} anyway
        </label>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-danger btn-m" [disabled]="plan.defaultBranch && !defaultBranch()">
          <span>Force push</span>
        </button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class ForcePushDialog {
  protected readonly request = inject<ForcePushRequest>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<ForcePushConfirmation>>(DialogRef);
  protected readonly plan = this.request.plan;
  protected readonly target = `${this.request.remote}/${this.request.remoteBranch}`;
  protected readonly defaultBranch = signal(false);
  protected readonly relativeTime = relativeTime;

  protected submit() {
    if (this.plan.defaultBranch && !this.defaultBranch()) return;
    this.dialog.close({ defaultBranch: this.defaultBranch() });
  }
}
