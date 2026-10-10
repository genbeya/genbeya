import { DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import type { StashOptions } from "../../../../contracts/model";
import { DialogFrame } from "../../ui/dialog-frame";

/** Asks how to stash the uncommitted changes; closes with the options, or nothing when cancelled. */
@Component({
  selector: "gd-stash-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame title="Stash changes" (submitted)="submit()">
      <label class="field">
        Message
        <input #field class="input" placeholder="Optional" [value]="message()" (input)="message.set(field.value)" />
      </label>
      <label class="checkbox">
        <input #untracked type="checkbox" [checked]="includeUntracked()" (change)="includeUntracked.set(untracked.checked)" />
        Include untracked files
      </label>
      <label class="checkbox">
        <input #index type="checkbox" [checked]="keepIndex()" (change)="keepIndex.set(index.checked)" />
        Keep staged changes in place
      </label>
      <p class="dialog-hint">Stashing sets the changes aside and cleans the working tree. Apply or pop the stash to get them back.</p>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m"><span>Stash</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class StashDialog {
  protected readonly dialog = inject<DialogRef<StashOptions>>(DialogRef);
  protected readonly message = signal("");
  protected readonly includeUntracked = signal(true);
  protected readonly keepIndex = signal(false);

  protected submit() {
    this.dialog.close({ message: this.message().trim(), includeUntracked: this.includeUntracked(), keepIndex: this.keepIndex() });
  }
}
