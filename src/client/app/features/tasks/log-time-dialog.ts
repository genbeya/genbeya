import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { formatEffort, parseEffort } from "../../../../utilities/planning";
import { DialogFrame } from "../../ui/dialog-frame";

export interface LogTimeRequest {
  /** The task's remaining effort in hours; null without one. */
  readonly remaining: number | null;
  /** Whether the project has a `remaining` field to update. */
  readonly tracksRemaining: boolean;
}

export interface LoggedTime {
  readonly hours: number;
  readonly note: string;
  /** The new remaining effort as written, such as `4h`; null to leave it. */
  readonly remaining: string | null;
}

/**
 * Asks for the time spent and what for, and, where the project tracks it,
 * what is left: the moment people know it best. Remaining starts as the old
 * value minus the time spent, never below zero.
 */
@Component({
  selector: "gd-log-time-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame title="Log time" (submitted)="submit()">
      <div class="log-time-row">
        <label class="field">
          Time spent
          <input #spentField class="input mono" placeholder="2h" [value]="spent()" (input)="spent.set(spentField.value)" />
        </label>
        <label class="field grow">
          What for
          <input
            #noteField
            class="input"
            placeholder="Reviewed the token validation"
            [value]="note()"
            (input)="note.set(noteField.value)"
          />
        </label>
      </div>
      @if (request.tracksRemaining) {
        <label class="field">
          Remaining
          <input
            #remainingField
            class="input mono"
            [placeholder]="suggested()"
            [value]="remaining()"
            (input)="remaining.set(remainingField.value)"
          />
        </label>
      }
      @if (problem(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      } @else {
        <p class="dialog-hint">Hours or days (2h, 0.5d). The entry goes into the task's time log, signed with your Git name.</p>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!hours()"><span>Log</span></button>
      </footer>
    </gd-dialog-frame>
  `,
  styles: `
    .log-time-row {
      display: flex;
      gap: 8px;
    }
    .log-time-row .field:first-child {
      width: 110px;
    }
  `,
})
export class LogTimeDialog {
  protected readonly request = inject<LogTimeRequest>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<LoggedTime>>(DialogRef);
  protected readonly spent = signal("");
  protected readonly note = signal("");
  /** Typed by the user; empty takes the suggestion. */
  protected readonly remaining = signal("");
  protected readonly hours = computed(() => parseEffort(this.spent().trim()));
  /** The old remaining effort minus the time spent. */
  protected readonly suggested = computed(() => {
    const before = this.request.remaining;
    if (before === null) return "";
    return formatEffort(Math.max(0, before - (this.hours() ?? 0)));
  });
  protected readonly problem = computed(() => {
    if (this.spent().trim() && !this.hours()) return "Write the time spent as hours or days, such as 2h or 0.5d.";
    if (this.remaining().trim() && parseEffort(this.remaining().trim()) === null) return "Write what is left as hours or days.";
    return null;
  });

  protected submit() {
    const hours = this.hours();
    if (!hours || this.problem()) return;
    const remaining = this.remaining().trim() || this.suggested() || null;
    this.dialog.close({ hours, note: this.note().trim(), remaining: this.request.tracksRemaining ? remaining : null });
  }
}
