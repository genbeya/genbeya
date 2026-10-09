import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { LucideArrowDown, LucideArrowDownToLine, LucideArrowUp, LucideArrowUpFromLine, LucideRefreshCw } from "@lucide/angular";
import { Session } from "../../core/session";
import { RepositoryActions } from "../shell/repository-actions";

/** The branch's upstream, ahead/behind counts, and fetch, pull and push. */
@Component({
  selector: "gd-sync-bar",
  imports: [LucideArrowDown, LucideArrowDownToLine, LucideArrowUp, LucideArrowUpFromLine, LucideRefreshCw],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./sync-bar.css",
  template: `
    <span class="grow ellipsis faint">{{ head().upstream ?? (remote() ? "no upstream on " + remote() : "no remote") }}</span>
    @if (head().ahead) {
      <span class="sync-count" [attr.aria-label]="head().ahead + ' ahead'"
        ><svg lucideArrowUp [size]="11" aria-hidden="true"></svg>{{ head().ahead }}</span
      >
    }
    @if (head().behind) {
      <span class="sync-count" [attr.aria-label]="head().behind + ' behind'"
        ><svg lucideArrowDown [size]="11" aria-hidden="true"></svg>{{ head().behind }}</span
      >
    }
    <button
      type="button"
      class="icon-btn"
      [attr.aria-label]="'Fetch from ' + remote()"
      [title]="'Fetch from ' + remote()"
      [disabled]="!remote() || session.busy()"
      (click)="sync('fetch')"
    >
      <svg lucideRefreshCw [size]="14" aria-hidden="true"></svg>
    </button>
    <button
      type="button"
      class="icon-btn"
      [attr.aria-label]="'Pull from ' + remote()"
      [title]="'Pull from ' + remote()"
      [disabled]="!remote() || session.busy() || !head().branch"
      (click)="sync('pull')"
    >
      <svg lucideArrowDownToLine [size]="14" aria-hidden="true"></svg>
    </button>
    <button
      type="button"
      class="icon-btn"
      [attr.aria-label]="'Push to ' + remote()"
      [title]="'Push to ' + remote()"
      [disabled]="!remote() || session.busy() || !head().branch"
      (click)="sync('push')"
    >
      <svg lucideArrowUpFromLine [size]="14" aria-hidden="true"></svg>
    </button>
  `,
})
export class SyncBar {
  protected readonly session = inject(Session);
  private readonly repository = inject(RepositoryActions);
  protected readonly head = computed(() => this.session.snapshot()!.head);
  protected readonly remote = computed(() => this.repository.remote());

  protected sync(action: "fetch" | "pull" | "push") {
    const remote = this.remote();
    if (remote) void this.repository.sync(action, remote);
  }
}
