import { ChangeDetectionStrategy, Component, computed, input, output } from "@angular/core";
import type { Change } from "../../../../contracts/model";
import { Icon } from "../../ui/icon";

/** A changed file in the staged or unstaged list, or a tree of them, with its actions on hover. */
@Component({
  selector: "gd-change-row",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./change-row.css",
  host: {
    "[attr.role]": "level() ? 'treeitem' : 'button'",
    "[attr.aria-level]": "level()",
    "[attr.aria-selected]": "level() ? selected() : null",
    "[attr.tabindex]": "tabbable() ? 0 : -1",
    "[style.padding-left.px]": "level() ? 4 + level()! * 14 : null",
    "[class.is-selected]": "selected()",
    "[attr.aria-current]": "selected() || null",
    "[title]": "change().oldPath ? change().oldPath + ' → ' + change().path : change().path",
    "(click)": "chosen.emit()",
    "(keydown.enter)": "chosen.emit()",
    "(keydown.space)": "$event.preventDefault(); chosen.emit()",
    "(dblclick)": "openFile.emit()",
  },
  template: `
    @if (level()) {
      <span class="change-indent" aria-hidden="true"></span>
    }
    <span class="change-name ellipsis">
      {{ name() }}
      @if (!level()) {
        <span class="change-dir">{{ folder() }}</span>
      }
    </span>
    <span class="change-actions">
      <button
        type="button"
        class="icon-btn"
        [attr.tabindex]="level() ? -1 : null"
        aria-label="Open file"
        title="Open file"
        (click)="$event.stopPropagation(); openFile.emit()"
      >
        <svg gd-icon name="file-code-2" [size]="13"></svg>
      </button>
      @if (!staged()) {
        <button
          type="button"
          class="icon-btn"
          [attr.tabindex]="level() ? -1 : null"
          aria-label="Discard changes"
          title="Discard changes"
          (click)="$event.stopPropagation(); discard.emit()"
        >
          <svg gd-icon name="undo-2" [size]="13"></svg>
        </button>
      }
      <button
        type="button"
        class="icon-btn"
        [attr.tabindex]="level() ? -1 : null"
        [attr.aria-label]="staged() ? 'Unstage' : 'Stage'"
        [title]="staged() ? 'Unstage' : 'Stage'"
        (click)="$event.stopPropagation(); toggleStaged.emit()"
      >
        @if (staged()) {
          <svg gd-icon name="minus" [size]="13"></svg>
        } @else {
          <svg gd-icon name="plus" [size]="13"></svg>
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
  /** The depth in a tree, from 1; null in a list, which shows the folder after the name instead. */
  readonly level = input<number | null>(null);
  /** Reached with Tab; a tree keeps one row tabbable and moves between rows with the arrows. */
  readonly tabbable = input(true);
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
