import { ChangeDetectionStrategy, Component, effect, inject, input, signal, untracked } from "@angular/core";
import { LucideColumns2, LucideRows2 } from "@lucide/angular";
import type { Diff } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { DiffView } from "../../editor/diff-view";
import { EmptyState } from "../../ui/empty-state";

const INLINE_KEY = "diff:inline";

function storedInline(): boolean {
  try {
    return localStorage.getItem(INLINE_KEY) === "1";
  } catch {
    return false;
  }
}

/** A file's diff with a header; reloads whenever the repository changes. Project actions into the header. */
@Component({
  selector: "gd-diff-pane",
  imports: [DiffView, EmptyState, LucideColumns2, LucideRows2],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./diff-pane.css",
  host: { class: "view" },
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
          <svg lucideColumns2 [size]="15" aria-hidden="true"></svg>
        } @else {
          <svg lucideRows2 [size]="15" aria-hidden="true"></svg>
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
      <gd-empty-state title="Binary file"><p>GitDesk does not show differences for binary files.</p></gd-empty-state>
    } @else {
      <gd-diff-view [path]="path()" [original]="diff()!.original" [modified]="diff()!.modified" [inline]="inline()" />
    }
  `,
})
export class DiffPane {
  readonly path = input.required<string>();
  /** Fetches the diff; called again on every repository change. */
  readonly load = input.required<() => Promise<Diff>>();
  readonly badge = input<string>();

  private readonly session = inject(Session);
  protected readonly diff = signal<Diff | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly inline = signal(storedInline());
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
      if (!current || current.original !== diff.original || current.modified !== diff.modified || current.binary !== diff.binary)
        this.diff.set(diff);
      this.error.set(null);
    } catch (failure) {
      if (ticket === this.request) this.error.set(messageOf(failure));
    }
  }

  protected toggleInline() {
    this.inline.update((inline) => !inline);
    try {
      localStorage.setItem(INLINE_KEY, this.inline() ? "1" : "0");
    } catch {
      // A remembered layout is a convenience.
    }
  }
}
