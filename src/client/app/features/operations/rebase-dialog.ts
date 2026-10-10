import { CdkDrag, type CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from "@angular/cdk/drag-drop";
import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { REBASE_ACTIONS, type RebaseAction, type RebaseCommit, type RebasePlan, type RebaseStep } from "../../../../contracts/model";
import { DialogFrame } from "../../ui/dialog-frame";
import { Icon } from "../../ui/icon";

export interface RebaseRequest {
  readonly plan: RebasePlan;
  readonly branch: string;
  /** Uncommitted changes, which are stashed meanwhile. */
  readonly dirty: boolean;
}

export interface Row {
  readonly commit: RebaseCommit;
  readonly action: RebaseAction;
  /** The new message of a reworded commit, or of the commit a squash joins. */
  readonly message: string;
  /**
   * The user wrote the message. A squash's message is otherwise the joined
   * messages of the commits it joins as they are now, so it follows
   * reordering and rewording; the backend joins them the same way.
   */
  readonly edited?: boolean;
}

const LABELS: Readonly<Record<RebaseAction, string>> = {
  pick: "Pick",
  reword: "Reword",
  squash: "Squash",
  fixup: "Fixup",
  drop: "Drop",
};

/** The message a commit gets when it squashes into the one before it: that one's message, then its own. */
export function squashMessage(rows: readonly Row[], index: number): string {
  for (let i = index - 1; i >= 0; i--) {
    const { action, message, commit } = rows[i]!;
    if (action === "pick") return `${commit.message}\n\n${rows[index]!.commit.message}`;
    if (action === "reword" || action === "squash") return `${message}\n\n${rows[index]!.commit.message}`;
  }
  return rows[index]!.commit.message;
}

/** `rows` with the messages of squashes the user has not written joined from the rows before them. */
export function withSquashMessages(rows: readonly Row[]): Row[] {
  const result: Row[] = [];
  for (const row of rows)
    result.push(row.action === "squash" && !row.edited ? { ...row, message: squashMessage([...result, row], result.length) } : row);
  return result;
}

/** Why the rows cannot run as they are, or null. */
export function problemOf(rows: readonly Row[]): string | null {
  const first = rows.find((row) => row.action !== "drop");
  if (first && (first.action === "squash" || first.action === "fixup"))
    return "The first commit kept can't be squashed into an earlier one.";
  if (rows.some((row) => row.action === "reword" && !row.message.trim())) return "Reworded commits need a message.";
  return null;
}

/**
 * Edits an interactive rebase: the commits after the chosen one, oldest
 * first, to reorder by dragging and to pick, reword, squash, fix up or drop.
 * Closes with the steps, or nothing when cancelled.
 */
@Component({
  selector: "gd-rebase-dialog",
  imports: [CdkDrag, CdkDragHandle, CdkDropList, DialogFrame, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./rebase-dialog.css",
  template: `
    <gd-dialog-frame [title]="'Rebase ' + request.branch + ' interactively'" [width]="680" (submitted)="submit()">
      <p class="dialog-hint rebase-hint">Oldest first. Drag to reorder; squash and fixup join a commit to the one above it.</p>
      <ol class="rebase-rows" cdkDropList aria-label="Commits" (cdkDropListDropped)="move($event)">
        @for (row of shown(); track row.commit.hash; let index = $index) {
          <li class="rebase-row" cdkDrag [class.is-dropped]="row.action === 'drop'">
            <div class="rebase-line">
              <span class="rebase-handle" cdkDragHandle aria-hidden="true"><svg gd-icon name="grip-vertical" [size]="14"></svg></span>
              <select
                #action
                class="select rebase-action"
                [attr.aria-label]="'Action for ' + row.commit.subject"
                [value]="row.action"
                (change)="setAction(index, $any(action.value))"
              >
                @for (option of actions; track option) {
                  <option [value]="option">{{ labels[option] }}</option>
                }
              </select>
              <span class="rebase-subject ellipsis" [title]="row.commit.subject">{{ row.commit.subject }}</span>
              <span class="rebase-hash mono">{{ row.commit.hash.slice(0, 7) }}</span>
            </div>
            @if (row.action === "reword" || row.action === "squash") {
              <textarea
                #message
                class="textarea rebase-message"
                rows="3"
                [attr.aria-label]="'Message for ' + row.commit.subject"
                [value]="row.message"
                (input)="setMessage(index, message.value)"
              ></textarea>
            }
          </li>
        }
      </ol>
      @if (request.plan.pushed.length) {
        <p class="rebase-warning" role="alert">
          <svg gd-icon name="triangle-alert" [size]="14"></svg>
          Some of these commits are already on {{ request.plan.pushed.join(", ") }}. Rewriting them means you will have to force-push.
        </p>
      }
      @if (request.dirty) {
        <p class="dialog-hint">Your uncommitted changes are stashed meanwhile and put back afterwards.</p>
      }
      @if (problem(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!!problem()"><span>Rebase</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class RebaseDialog {
  protected readonly request = inject<RebaseRequest>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<RebaseStep[]>>(DialogRef);
  protected readonly actions = REBASE_ACTIONS;
  protected readonly labels = LABELS;
  protected readonly rows = signal<readonly Row[]>(
    this.request.plan.commits.map((commit) => ({ commit, action: "pick", message: commit.message })),
  );
  protected readonly shown = computed(() => withSquashMessages(this.rows()));
  protected readonly problem = computed(() => problemOf(this.shown()));

  protected move(event: CdkDragDrop<unknown>) {
    const rows = [...this.rows()];
    moveItemInArray(rows, event.previousIndex, event.currentIndex);
    this.rows.set(rows);
  }

  protected setAction(index: number, action: RebaseAction) {
    this.rows.update((rows) => {
      const next = [...rows];
      const row = next[index]!;
      next[index] = { ...row, action, message: row.commit.message, edited: false };
      return next;
    });
  }

  protected setMessage(index: number, message: string) {
    this.rows.update((rows) => rows.map((row, i) => (i === index ? { ...row, message, edited: true } : row)));
  }

  protected submit() {
    if (this.problem()) return;
    this.dialog.close(
      // A squash message the user did not write is left to the backend, which joins the messages in the final order.
      this.rows().map(({ commit, action, message, edited }) => ({
        hash: commit.hash,
        action,
        ...(action === "reword" || (action === "squash" && edited) ? { message: message.trim() } : {}),
      })),
    );
  }
}
