import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import type { PullInput, PullRequest } from "../../../../contracts/model";
import { DialogFrame } from "../../ui/dialog-frame";

export interface PullDialogData {
  /** The pull request to edit; none for a new one. */
  readonly pull?: PullRequest;
  /** Branches to choose from: local ones, then remote ones. */
  readonly branches: readonly string[];
  /** Preselected for a new pull request: the current branch and the default branch. */
  readonly source?: string;
  readonly target?: string;
  /** People to suggest as reviewers. */
  readonly people: readonly string[];
}

const splitNames = (text: string) => [
  ...new Set(
    text
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean),
  ),
];

/** Asks for a pull request's branches, title, reviewers and description; closes with them, or nothing when cancelled. */
@Component({
  selector: "gd-pull-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="data.pull ? 'Edit ' + data.pull.id : 'New pull request'" [width]="560" (submitted)="submit()">
      <div class="pull-dialog-branches">
        <label class="field">
          Merge
          <select #sourceField class="select" (change)="source.set(sourceField.value)">
            @for (branch of data.branches; track branch) {
              <option [value]="branch" [selected]="branch === source()">{{ branch }}</option>
            }
          </select>
        </label>
        <span class="pull-dialog-arrow" aria-hidden="true">→</span>
        <label class="field">
          into
          <select class="select" #targetField (change)="target.set(targetField.value)">
            @for (branch of data.branches; track branch) {
              <option [value]="branch" [selected]="branch === target()">{{ branch }}</option>
            }
          </select>
        </label>
      </div>
      <label class="field">
        Title
        <input #titleField class="input" [value]="title()" (input)="title.set(titleField.value)" />
      </label>
      <label class="field">
        Reviewers
        <input
          #reviewersField
          class="input"
          placeholder="Names, separated by commas"
          list="pull-dialog-people"
          [value]="reviewers()"
          (input)="reviewers.set(reviewersField.value)"
        />
        <datalist id="pull-dialog-people">
          @for (person of data.people; track person) {
            <option [value]="person"></option>
          }
        </datalist>
      </label>
      @if (!data.pull) {
        <label class="field">
          Description
          <textarea
            #bodyField
            class="textarea"
            rows="6"
            placeholder="What the change does and why. Markdown and [[references]] work."
            [value]="body()"
            (input)="body.set(bodyField.value)"
          ></textarea>
        </label>
        <label class="checkbox">
          <input #draftField type="checkbox" [checked]="draft()" (change)="draft.set(draftField.checked)" />
          Draft: not ready for review yet
        </label>
      }
      @if (problem(); as message) {
        <p class="dialog-error" role="alert">{{ message }}</p>
      }
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!!problem()">
          <span>{{ data.pull ? "Save" : "Open pull request" }}</span>
        </button>
      </footer>
    </gd-dialog-frame>
  `,
  styles: `
    .pull-dialog-branches {
      display: flex;
      align-items: flex-end;
      gap: 8px;
    }
    .pull-dialog-branches .field {
      flex: 1;
      min-width: 0;
    }
    .pull-dialog-arrow {
      padding-bottom: 6px;
      color: var(--text-3);
    }
  `,
})
export class PullDialog {
  protected readonly data = inject<PullDialogData>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<PullInput>>(DialogRef);
  protected readonly source = signal(this.data.pull?.source ?? this.data.source ?? this.data.branches[0] ?? "");
  protected readonly target = signal(this.data.pull?.target ?? this.data.target ?? "");
  protected readonly title = signal(this.data.pull?.title ?? "");
  protected readonly reviewers = signal(this.data.pull?.reviewers.join(", ") ?? "");
  protected readonly body = signal("");
  protected readonly draft = signal(false);
  protected readonly problem = computed(() => {
    if (!this.source() || !this.target()) return "Choose the branches.";
    if (this.source() === this.target()) return "A branch can't be merged into itself.";
    return this.title().trim() ? null : "";
  });

  protected submit() {
    if (this.problem() !== null) return;
    const pull = this.data.pull;
    this.dialog.close({
      title: this.title().trim(),
      status: pull ? pull.status : this.draft() ? "draft" : "open",
      source: this.source(),
      target: this.target(),
      reviewers: splitNames(this.reviewers()),
      body: pull ? pull.body : this.body().trim() ? `${this.body().trim()}\n` : "",
    });
  }
}
