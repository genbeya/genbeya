import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { afterNextRender, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from "@angular/core";
import { DialogFrame } from "../../ui/dialog-frame";

export interface RefDialogOptions {
  readonly kind: "branch" | "tag";
  /** Where the ref will point, as shown to the user, such as "a1b2c3d Fix the build". */
  readonly at: string;
  /** Creates the ref before the dialog closes; a failure's message keeps it open to correct the name. */
  readonly accept?: (ref: NewRef) => Promise<string | null>;
}

/** A new branch (and whether to switch to it) or tag (and its message). */
export interface NewRef {
  readonly name: string;
  readonly checkout: boolean;
  readonly message: string;
}

/** Asks for the name of a branch or tag to create at a commit. */
@Component({
  selector: "gd-ref-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="branch ? 'Create branch' : 'Create tag'" (submitted)="submit()">
      <label class="field">
        {{ branch ? "Branch name" : "Tag name" }}
        <input
          #field
          class="input"
          spellcheck="false"
          [placeholder]="branch ? 'feature/my-change' : 'v1.0.0'"
          [value]="name()"
          (input)="name.set(field.value); error.set(null)"
        />
      </label>
      @if (branch) {
        <label class="checkbox">
          <input #switchTo type="checkbox" [checked]="checkout()" (change)="checkout.set(switchTo.checked)" />
          Switch to the new branch
        </label>
      } @else {
        <label class="field">
          Message
          <textarea
            #messageField
            class="textarea"
            rows="3"
            placeholder="Optional; makes an annotated tag"
            [value]="message()"
            (input)="message.set(messageField.value)"
          ></textarea>
        </label>
      }
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
      <p class="dialog-hint">At {{ options.at }}</p>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="empty() || accepting()"><span>Create</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class RefDialog {
  protected readonly options = inject<RefDialogOptions>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<NewRef>>(DialogRef);
  protected readonly branch = this.options.kind === "branch";
  protected readonly name = signal("");
  protected readonly checkout = signal(true);
  protected readonly message = signal("");
  protected readonly empty = computed(() => !this.name().trim());
  protected readonly error = signal<string | null>(null);
  protected readonly accepting = signal(false);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field");

  constructor() {
    afterNextRender(() => this.field().nativeElement.focus());
  }

  protected async submit() {
    if (this.empty() || this.accepting()) return;
    const ref = { name: this.name().trim(), checkout: this.checkout(), message: this.message().trim() };
    if (this.options.accept) {
      this.accepting.set(true);
      const failure = await this.options.accept(ref).finally(() => this.accepting.set(false));
      if (failure) return this.error.set(failure);
    }
    this.dialog.close(ref);
  }
}
