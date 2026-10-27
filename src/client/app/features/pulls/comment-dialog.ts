import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { ChangeDetectionStrategy, Component, computed, inject, signal } from "@angular/core";
import { DialogFrame } from "../../ui/dialog-frame";

export interface CommentRequest {
  /** `src/a.ts#L3-L5`, as the dialog names the lines. */
  readonly where: string;
  /** The selected lines as they are now, to suggest an edit of. */
  readonly text: string;
  /** Topics to add the code range to, by the line they start on. */
  readonly topics: readonly { readonly line: number; readonly title: string }[];
}

export interface CommentResult {
  /** The topic to add to; null for a new one. */
  readonly topic: number | null;
  readonly title: string;
  readonly comment: string;
  /** A `diff` of the lines: the selected ones removed, the edited ones added; null without a suggestion. */
  readonly suggestion: string | null;
  readonly todo: string;
}

/** The lines of `before` removed and those of `after` added, as a `diff` block holds them. */
export function suggestionDiff(before: string, after: string): string {
  const lines = (text: string) => text.replace(/\n$/, "").split("\n");
  return [...lines(before).map((line) => `-${line}`), ...lines(after).map((line) => `+${line}`)].join("\n");
}

/** Asks what to say about lines of a pull request's diff: in a new topic or an existing one, with an optional suggestion and to-do. */
@Component({
  selector: "gd-comment-dialog",
  imports: [DialogFrame],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-dialog-frame [title]="'Comment on ' + request.where" [width]="620" (submitted)="submit()">
      @if (request.topics.length) {
        <label class="field">
          Topic
          <select #topicField class="select" (change)="topic.set(topicField.value === 'new' ? null : +topicField.value)">
            <option value="new" [selected]="topic() === null">New topic</option>
            @for (item of request.topics; track item.line) {
              <option [value]="item.line" [selected]="topic() === item.line">{{ item.title }}</option>
            }
          </select>
        </label>
      }
      @if (topic() === null) {
        <label class="field">
          Topic title
          <input
            #titleField
            class="input"
            placeholder="The issue, in a few words"
            [value]="title()"
            (input)="title.set(titleField.value)"
          />
        </label>
      }
      <label class="field">
        Comment
        <textarea #commentField class="textarea" rows="3" [value]="comment()" (input)="comment.set(commentField.value)"></textarea>
      </label>
      <label class="checkbox">
        <input #suggestField type="checkbox" [checked]="suggesting()" (change)="suggesting.set(suggestField.checked)" />
        Suggest a change of these lines
      </label>
      @if (suggesting()) {
        <textarea
          #editField
          class="textarea mono"
          aria-label="Suggested lines"
          rows="6"
          spellcheck="false"
          [value]="edited()"
          (input)="edited.set(editField.value)"
        ></textarea>
      }
      <label class="field">
        To-do
        <input #todoField class="input" placeholder="Optional: what has to be done" [value]="todo()" (input)="todo.set(todoField.value)" />
      </label>
      <footer>
        <button type="button" class="btn btn-default btn-m" (click)="dialog.close()"><span>Cancel</span></button>
        <button type="submit" class="btn btn-primary btn-m" [disabled]="!ready()"><span>Comment</span></button>
      </footer>
    </gd-dialog-frame>
  `,
})
export class CommentDialog {
  protected readonly request = inject<CommentRequest>(DIALOG_DATA);
  protected readonly dialog = inject<DialogRef<CommentResult>>(DialogRef);
  protected readonly topic = signal<number | null>(null);
  protected readonly title = signal("");
  protected readonly comment = signal("");
  protected readonly suggesting = signal(false);
  protected readonly edited = signal(this.request.text);
  protected readonly todo = signal("");
  private readonly suggestion = computed(() =>
    this.suggesting() && this.edited() !== this.request.text ? suggestionDiff(this.request.text, this.edited()) : null,
  );
  protected readonly ready = computed(
    () => (this.topic() !== null || !!this.title().trim()) && (!!this.comment().trim() || !!this.suggestion() || !!this.todo().trim()),
  );

  protected submit() {
    if (!this.ready()) return;
    this.dialog.close({
      topic: this.topic(),
      title: this.title().trim(),
      comment: this.comment().trim(),
      suggestion: this.suggestion(),
      todo: this.todo().trim(),
    });
  }
}
