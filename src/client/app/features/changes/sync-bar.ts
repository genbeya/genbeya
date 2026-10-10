import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { Session } from "../../core/session";
import { Icon } from "../../ui/icon";
import { RepositoryActions } from "../shell/repository-actions";

/** The branch's upstream, ahead/behind counts, and fetch, pull and push. */
@Component({
  selector: "gd-sync-bar",
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./sync-bar.css",
  template: `
    <span class="grow ellipsis faint">{{ head().upstream ?? (remote() ? "no upstream on " + remote() : "no remote") }}</span>
    @if (head().ahead) {
      <span class="sync-count" [attr.aria-label]="head().ahead + ' ahead'"
        ><svg gd-icon name="arrow-up" [size]="11"></svg>{{ head().ahead }}</span
      >
    }
    @if (head().behind) {
      <span class="sync-count" [attr.aria-label]="head().behind + ' behind'"
        ><svg gd-icon name="arrow-down" [size]="11"></svg>{{ head().behind }}</span
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
      <svg gd-icon name="refresh-cw" [size]="14"></svg>
    </button>
    <button
      type="button"
      class="icon-btn"
      [attr.aria-label]="'Pull from ' + remote()"
      [title]="'Pull from ' + remote()"
      [disabled]="!remote() || session.busy() || !head().branch"
      (click)="sync('pull')"
    >
      <svg gd-icon name="arrow-down-to-line" [size]="14"></svg>
    </button>
    <button
      type="button"
      class="icon-btn"
      [attr.aria-label]="'Push to ' + remote()"
      [title]="'Push to ' + remote()"
      [disabled]="!remote() || session.busy() || !head().branch"
      (click)="sync('push')"
    >
      <svg gd-icon name="arrow-up-from-line" [size]="14"></svg>
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
