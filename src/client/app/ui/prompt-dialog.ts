import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { afterNextRender, ChangeDetectionStrategy, Component, computed, type ElementRef, inject, signal, viewChild } from "@angular/core";
import { DialogFrame } from "./dialog-frame";

export interface PromptOptions {
  readonly title: string;
  readonly label: string;
  readonly initial?: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly confirm?: string;
  /** An error message keeps the dialog open. */
  readonly validate?: (value: string) => string | null;
  /**
   * Does what the dialog asks for with the value before it closes; a failure's
   * message keeps it open, with the value, to correct it.
   */
  readonly accept?: (value: string) => Promise<string | null>;
}

/** Focuses a path field and selects the name, not the folder or extension, like file managers do. */
export function selectName(input: HTMLInputElement): void {
  const slash = input.value.lastIndexOf("/");
  const dot = input.value.lastIndexOf(".");
  input.focus();
  input.setSelectionRange(slash + 1, dot > slash ? dot : input.value.length);
}

/** Asks for one line of text; closes with the trimmed text, or nothing when cancelled. */
@Component({
  selector: "gd-prompt-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="options.title" (submitted)="submit()">
      <label class="field">
        {{ options.label }}
        <input
          #field
          class="input"
          spellcheck="false"
          [value]="text()"
          [attr.placeholder]="options.placeholder ?? null"
          (input)="edit(field.value)"
        />
      </label>
      @if (error(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      } @else if (options.hint) {
        <p class="dialog-hint">{{ options.hint }}</p>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="empty() || accepting()">
          <span>{{ options.confirm ?? "OK" }}</span>
        </button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class PromptDialog {
  protected readonly options = inject<PromptOptions>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<string>>(DialogRef);
  protected readonly text = signal(this.options.initial ?? "");
  protected readonly error = signal<string | null>(null);
  protected readonly empty = computed(() => !this.text().trim());
  protected readonly accepting = signal(false);
  private readonly field = viewChild.required<ElementRef<HTMLInputElement>>("field");

  constructor() {
    afterNextRender(() => selectName(this.field().nativeElement));
  }

  protected edit(value: string) {
    this.text.set(value);
    this.error.set(null);
  }

  protected async submit() {
    const value = this.text().trim();
    if (!value || this.accepting()) return;
    const problem = this.options.validate?.(value) ?? null;
    if (problem) return this.error.set(problem);
    if (this.options.accept) {
      this.accepting.set(true);
      const failure = await this.options.accept(value).finally(() => this.accepting.set(false));
      if (failure) return this.error.set(failure);
    }
    this.dialog.close(value);
  }
}
