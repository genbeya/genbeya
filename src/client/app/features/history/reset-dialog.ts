import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import type { ResetMode, ResetPlan } from "../../../../contracts/model";
import { DialogFrame } from "../../ui/dialog-frame";

export interface ResetRequest {
  readonly plan: ResetPlan;
  /** The commit to reset to, as shown to the user, such as "a1b2c3d Fix the build". */
  readonly at: string;
}

const MODES: readonly { readonly mode: ResetMode; readonly label: string; readonly text: string }[] = [
  { mode: "soft", label: "Soft", text: "Keep all changes, staged: the changes of the commits that leave are ready to commit again." },
  { mode: "mixed", label: "Mixed", text: "Keep all changes, unstaged: the changes of the commits that leave stay in your files." },
  {
    mode: "keep",
    label: "Keep",
    text: "Files go back to the commit, but your uncommitted changes stay. Refuses if it would overwrite them.",
  },
  { mode: "hard", label: "Hard", text: "Discard all changes: files go back to the commit exactly, uncommitted changes included." },
];
/** Uncommitted files named before "and n more". */
const NAMED = 5;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** The first files, then how many more. */
const named = (files: readonly string[]) =>
  files.slice(0, NAMED).join(", ") + (files.length > NAMED ? ` and ${files.length - NAMED} more` : "");

/** Commits the upstream has that the reset takes off the branch come back as "behind"; null when there are none. */
function pushedWarning({ branch, commits, pushed, upstream }: ResetPlan): string | null {
  if (!pushed) return null;
  const which =
    pushed === commits ? (pushed === 1 ? "That commit is" : "These commits are") : `${pushed} of them ${pushed === 1 ? "is" : "are"}`;
  const them = pushed === 1 ? "it" : "them";
  return `${which} already on ${upstream}. Afterwards ${branch} is behind it and a pull brings ${them} back; removing ${them} there as well takes a force push.`;
}

/** Asks how to reset the current branch to a commit; closes with the mode, or nothing when cancelled. */
@Component({
  selector: "gd-reset-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./reset-dialog.css",
  template: `
    <gd-dialog-frame [title]="'Reset ' + plan.branch" [width]="520" (submitted)="submit()">
      <p class="dialog-message">{{ summary }}</p>
      <div class="reset-modes" role="radiogroup" aria-label="What to keep">
        @for (option of modes; track option.mode) {
          <label class="reset-mode" [class.is-selected]="mode() === option.mode">
            <input type="radio" name="reset-mode" [checked]="mode() === option.mode" (change)="mode.set(option.mode)" />
            <span
              ><strong>{{ option.label }}</strong> {{ option.text }}</span
            >
          </label>
        }
      </div>
      @if (pushedWarning; as warning) {
        <p class="dialog-warning">{{ warning }}</p>
      }
      @if (discarding()) {
        <p class="dialog-warning is-danger">{{ lost }}</p>
      }
      @if (overwriting()) {
        <p class="dialog-warning is-danger">{{ replaced }}</p>
      }
      @if (losing()) {
        <label class="checkbox">
          <input #confirm type="checkbox" [checked]="confirmed()" (change)="confirmed.set(confirm.checked)" />
          {{ discarding() ? "Discard my uncommitted changes" : "Replace these files" }}
        </label>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button
          type="submit"
          class="btn btn-m"
          [class.btn-danger]="mode() === 'hard'"
          [class.btn-primary]="mode() !== 'hard'"
          [disabled]="losing() && !confirmed()"
        >
          <span>Reset</span>
        </button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class ResetDialog {
  private readonly request = inject<ResetRequest>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<ResetMode>>(DialogRef);
  protected readonly plan = this.request.plan;
  protected readonly modes = MODES;
  protected readonly mode = signal<ResetMode>("mixed");
  protected readonly confirmed = signal(false);
  /** A hard reset that throws away uncommitted changes. */
  protected readonly discarding = computed(() => this.mode() === "hard" && this.plan.uncommitted.length > 0);
  /** A hard or keep reset that replaces untracked or ignored files with the commit's. */
  protected readonly overwriting = computed(() => (this.mode() === "hard" || this.mode() === "keep") && this.plan.overwritten.length > 0);
  /** Either needs a second yes. */
  protected readonly losing = computed(() => this.discarding() || this.overwriting());

  protected readonly summary =
    `Moves ${this.plan.branch} to ${this.request.at}. ` +
    (this.plan.commits
      ? `${plural(this.plan.commits, "commit")} ${this.plan.commits === 1 ? "leaves" : "leave"} ${this.plan.branch}.`
      : `No commits leave ${this.plan.branch}.`);
  protected readonly pushedWarning = pushedWarning(this.plan);

  protected readonly lost = `Your uncommitted changes to ${plural(this.plan.uncommitted.length, "file")} are lost: ${named(this.plan.uncommitted)}.`;
  protected readonly replaced =
    `The commit has ${plural(this.plan.overwritten.length, "file")} you have but Git does not track here, which ` +
    `${this.plan.overwritten.length === 1 ? "is" : "are"} replaced with the commit's: ${named(this.plan.overwritten)}.`;

  protected submit() {
    if (this.losing() && !this.confirmed()) return;
    this.dialog.close(this.mode());
  }
}
