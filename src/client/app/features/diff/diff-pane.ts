import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChild } from "@angular/core";
import type { Diff, LineSelection } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { DiffView, type DiffLines, type HunkAction, type HunkEvent } from "../../editor/diff-view";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import type { IconName } from "../../ui/icon-data";
import { Remembered } from "../../ui/remembered";

const INLINE_KEY = "diff:inline";

/** Something to do with parts of a diff: "Stage" becomes "Stage hunk" and "Stage selected lines". */
export interface DiffAction {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly danger?: boolean;
}

/** How an action on lines went: a cancelled one keeps the selection, a failed one shows the diff as it is now. */
export type DiffActionOutcome = "done" | "failed" | "cancelled";

/** Runs an action on lines chosen in the version `version` of the diff. */
export type DiffActionHandler = (action: string, lines: LineSelection, version: string, hunk: boolean) => Promise<DiffActionOutcome>;

const lineCount = (selection: LineSelection) =>
  [...selection.original, ...selection.modified].reduce((total, range) => total + range.to - range.from + 1, 0);

/**
 * A file's diff with a header; reloads whenever the repository changes, and
 * after its actions. Project actions into the header. With `actions`, each
 * changed chunk offers them, and a toolbar offers them for selected lines.
 */
@Component({
  selector: "gd-diff-pane",
  imports: [DiffView, EmptyState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./diff-pane.css",
  // Changes made in another app show once the window is back.
  host: { class: "view", "(window:focus)": "reload()" },
  template: `
    <header class="view-header">
      <div class="view-title mono diff-path ellipsis">{{ path() }}</div>
      @if (badge()) {
        <span class="diff-badge">{{ badge() }}</span>
      }
      <span class="grow"></span>
      <ng-content />
      <button
        type="button"
        class="icon-btn"
        [attr.aria-label]="inline() ? 'Side by side' : 'Inline'"
        [title]="inline() ? 'Side by side' : 'Inline'"
        (click)="toggleInline()"
      >
        @if (inline()) {
          <svg gd-icon name="columns-2" [size]="15"></svg>
        } @else {
          <svg gd-icon name="rows-2" [size]="15"></svg>
        }
      </button>
    </header>
    @if (error(); as message) {
      <gd-empty-state title="Can't show this diff"
        ><p class="selectable">{{ message }}</p></gd-empty-state
      >
    } @else if (!diff()) {
      <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
    } @else if (diff()!.binary) {
      <gd-empty-state title="Binary file"><p>Genbeya does not show differences for binary files.</p></gd-empty-state>
    } @else {
      @if (actions().length && !diff()!.changes) {
        <div class="diff-toolbar">
          <span class="diff-toolbar-text">Genbeya can only stage this file as a whole.</span>
        </div>
      } @else if (actions().length) {
        <div class="diff-toolbar" role="toolbar" aria-label="Selected lines">
          @if (selection(); as selected) {
            <span class="diff-toolbar-text">{{ count() }} {{ count() === 1 ? "line" : "lines" }} selected</span>
            @for (action of actions(); track action.id) {
              <button
                type="button"
                class="btn btn-s"
                [class.is-danger]="action.danger"
                [disabled]="running()"
                (click)="run(action.id, selected)"
              >
                <svg gd-icon [name]="action.icon" [size]="13"></svg>{{ action.label }} selected lines
              </button>
            }
          } @else {
            <span class="diff-toolbar-text">Select lines by their numbers, or use the bar above a change.</span>
          }
        </div>
      }
      <gd-diff-view
        [path]="path()"
        [diff]="diff()!"
        [inline]="inline()"
        [hunkActions]="diff()!.changes ? hunkActions() : []"
        (hunk)="onHunk($event)"
        (lines)="selection.set($event)"
      />
    }
  `,
})
export class DiffPane {
  readonly path = input.required<string>();
  /** Fetches the diff; called again on every repository change. */
  readonly load = input.required<() => Promise<Diff>>();
  readonly badge = input<string>();
  readonly actions = input<readonly DiffAction[]>([]);
  readonly apply = input<DiffActionHandler>(async () => "done");

  private readonly session = inject(Session);
  private readonly memory = inject(Remembered);
  private readonly view = viewChild(DiffView);
  protected readonly diff = signal<Diff | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly inline = signal(this.memory.recall(INLINE_KEY) === "1");
  protected readonly selection = signal<DiffLines | null>(null);
  protected readonly running = signal(false);
  protected readonly count = computed(() => {
    const selection = this.selection();
    return selection ? lineCount(selection.lines) : 0;
  });
  protected readonly hunkActions = computed<HunkAction[]>(() =>
    this.actions().map((action) => ({ id: action.id, label: `${action.label} hunk`, danger: action.danger })),
  );
  private request = 0;

  constructor() {
    effect(() => {
      const load = this.load();
      // Any repository change may change the diff.
      this.session.snapshot();
      untracked(() => void this.fetch(load));
    });
  }

  private async fetch(load: () => Promise<Diff>) {
    const ticket = ++this.request;
    try {
      const diff = await load();
      if (ticket !== this.request) return;
      // An unchanged diff keeps its view, so scrolling is not reset on every poll.
      const current = this.diff();
      if (
        !current ||
        current.version !== diff.version ||
        current.original !== diff.original ||
        current.modified !== diff.modified ||
        current.binary !== diff.binary ||
        !current.changes !== !diff.changes
      )
        this.diff.set(diff);
      this.error.set(null);
    } catch (failure) {
      if (ticket === this.request) this.error.set(messageOf(failure));
    }
  }

  protected toggleInline() {
    this.inline.update((inline) => !inline);
    this.memory.remember(INLINE_KEY, this.inline() ? "1" : "0");
  }

  protected onHunk(event: HunkEvent) {
    void this.run(event.action, event, true);
  }

  /** Shows the diff as it is now. */
  protected reload(): Promise<void> {
    return this.fetch(this.load());
  }

  /**
   * Runs an action on lines of the diff shown, then shows the diff as it is
   * now: the snapshot may not change when a file was partly staged already,
   * and a file changed outside the app changes no snapshot either.
   */
  protected async run(action: string, { lines, version }: DiffLines, hunk = false) {
    if (this.running()) return;
    this.running.set(true);
    let outcome: DiffActionOutcome;
    try {
      outcome = await this.apply()(action, lines, version, hunk);
    } finally {
      this.running.set(false);
    }
    if (outcome === "cancelled") return;
    if (outcome === "done") this.view()?.clearSelection();
    await this.reload();
  }
}
