import { DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, inject, input, output } from "@angular/core";
import { Icon } from "./icon";

/**
 * The frame of every dialog: title, close button, body and an optional
 * footer (`<ng-container footer>`). Enter submits through the form.
 */
@Component({
  selector: "gd-dialog-frame",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="dialog" role="dialog" aria-modal="true" [attr.aria-label]="title()" [style.width.px]="width()" (submit)="submit($event)">
      <header>
        <h2>{{ title() }}</h2>
        <button type="button" class="icon-btn" aria-label="Close" title="Close" (click)="dialog.close()">
          <svg gd-icon name="x" [size]="16"></svg>
        </button>
      </header>
      <div class="dialog-body"><ng-content /></div>
      <ng-content select="footer" />
    </form>
  `,
})
export class DialogFrame {
  protected readonly dialog = inject(DialogRef);
  readonly title = input.required<string>();
  readonly width = input(440);
  readonly submitted = output();

  protected submit(event: Event) {
    event.preventDefault();
    this.submitted.emit();
  }
}
