import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import { LucideFileCode2, LucideMinus, LucidePlus, LucideUndo2 } from "@lucide/angular";
import type { Change } from "../../../../contracts/model";

/** A changed file in the staged or unstaged list, with its actions on hover. */
@Component({
  selector: "gd-change-row",
  imports: [LucideFileCode2, LucideMinus, LucidePlus, LucideUndo2],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./change-row.css",
  host: {
    role: "button",
    tabindex: "0",
    "[class.is-selected]": "selected()",
    "[attr.aria-current]": "selected() || null",
    "[title]": "change().oldPath ? change().oldPath + ' → ' + change().path : change().path",
    "(click)": "chosen.emit()",
    "(keydown.enter)": "chosen.emit()",
    "(keydown.space)": "$event.preventDefault(); chosen.emit()",
    "(dblclick)": "openFile.emit()",
  },
  template: `
    <span class="change-name ellipsis">
      {{ name() }}<span class="change-dir">{{ folder() }}</span>
    </span>
    <span class="change-actions">
      <button type="button" class="icon-btn" aria-label="Open file" title="Open file" (click)="$event.stopPropagation(); openFile.emit()">
        <svg lucideFileCode2 [size]="13" aria-hidden="true"></svg>
      </button>
      @if (!staged()) {
        <button
          type="button"
          class="icon-btn"
          aria-label="Discard changes"
          title="Discard changes"
          (click)="$event.stopPropagation(); discard.emit()"
        >
          <svg lucideUndo2 [size]="13" aria-hidden="true"></svg>
        </button>
      }
      <button
        type="button"
        class="icon-btn"
        [attr.aria-label]="staged() ? 'Unstage' : 'Stage'"
        [title]="staged() ? 'Unstage' : 'Stage'"
        (click)="$event.stopPropagation(); toggleStaged.emit()"
      >
        @if (staged()) {
          <svg lucideMinus [size]="13" aria-hidden="true"></svg>
        } @else {
          <svg lucidePlus [size]="13" aria-hidden="true"></svg>
        }
      </button>
    </span>
    <span class="status-letter {{ letter() }}" [attr.aria-label]="'Status ' + letter()">{{ letter() }}</span>
  `,
})
export class ChangeRow {
  readonly change = input.required<Change>();
  readonly staged = input.required<boolean>();
  readonly selected = input(false);
  readonly chosen = output();
  readonly openFile = output();
  readonly toggleStaged = output();
  readonly discard = output();
  private readonly slash = computed(() => this.change().path.lastIndexOf("/"));
  protected readonly name = computed(() => this.change().path.slice(this.slash() + 1));
  protected readonly folder = computed(() => (this.slash() > 0 ? this.change().path.slice(0, this.slash()) : ""));
  /** The index letter when staged, the working-tree letter otherwise; untracked files are U. */
  protected readonly letter = computed(() => {
    const change = this.change();
    return this.staged() ? change.index : change.index === "?" ? "U" : change.worktree;
  });
}
