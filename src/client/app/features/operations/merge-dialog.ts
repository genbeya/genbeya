import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { MergeOptions } from "../../../../contracts/model";
import { DialogFrame } from "../../ui/dialog-frame";

export interface MergeRequest {
  /** What is merged: a branch, remote branch or tag name, or a commit ID. */
  readonly source: string;
  readonly kind: "branch" | "remote" | "tag" | "commit";
  /** The current branch. */
  readonly target: string;
}

/** The message git writes for a merge commit, as `git merge` would. */
export function defaultMergeMessage({ source, kind, target }: MergeRequest): string {
  const what =
    kind === "remote"
      ? `remote-tracking branch '${source}'`
      : kind === "tag"
        ? `tag '${source}'`
        : kind === "commit"
          ? `commit '${source.slice(0, 7)}'`
          : `branch '${source}'`;
  return `Merge ${what}${target === "main" || target === "master" ? "" : ` into ${target}`}`;
}

/** Asks how to merge; closes with the options, or nothing when cancelled. */
@Component({
  selector: "gd-merge-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="title" [width]="480" (submitted)="submit()">
      <label class="field">
        Merge commit message
        <textarea #field class="textarea" rows="4" [value]="message()" (input)="message.set(field.value)"></textarea>
      </label>
      <label class="checkbox">
        <input #always type="checkbox" [checked]="noFastForward()" (change)="noFastForward.set(always.checked)" />
        Always create a merge commit
      </label>
      <p class="dialog-hint">
        Without a merge commit, {{ request.target }} simply moves forward when it has no commits of its own. Conflicts stop the merge until
        you resolve them.
      </p>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m"><span>Merge</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class MergeDialog {
  protected readonly request = inject<MergeRequest>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<MergeOptions>>(DialogRef);
  protected readonly title = `Merge ${this.request.kind === "commit" ? this.request.source.slice(0, 7) : this.request.source} into ${this.request.target}`;
  private readonly prepared = defaultMergeMessage(this.request);
  protected readonly message = signal(this.prepared);
  protected readonly noFastForward = signal(false);

  protected submit() {
    // Git's own message also lists conflicts; an edited one replaces it.
    const message = this.message().trim();
    this.dialog.close({ noFastForward: this.noFastForward(), message: message === this.prepared ? "" : message });
  }
}
