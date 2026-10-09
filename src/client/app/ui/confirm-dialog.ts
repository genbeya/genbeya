import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject } from "@angular/core";
import { DialogFrame } from "./dialog-frame";

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirm: string;
  readonly danger?: boolean;
}

/** Asks to confirm an action; closes with true when confirmed. */
@Component({
  selector: "gd-confirm-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="options.title" (submitted)="dialog.close(true)">
      <div class="dialog-message">{{ options.message }}</div>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close(false)"><span>Cancel</span></button>
        <button type="submit" cdkFocusInitial class="btn btn-m" [class.btn-danger]="options.danger" [class.btn-primary]="!options.danger">
          <span>{{ options.confirm }}</span>
        </button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class ConfirmDialog {
  protected readonly options = inject<ConfirmOptions>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<boolean>>(DialogRef);
}
