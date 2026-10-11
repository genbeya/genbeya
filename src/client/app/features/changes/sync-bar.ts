import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject } from "@angular/core";
import { Session } from "../../core/session";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";
import { ResetActions } from "../history/reset-actions";
import { PushActions, publishRemote } from "../push/push-actions";
import { RepositoryActions } from "../shell/repository-actions";

/**
 * The branch's upstream, ahead/behind counts, and fetch, pull and push,
 * which need a remote; a branch without upstream is published instead of
 * pushed. Its menu pushes elsewhere and undoes the last commit.
 */
@Component({
  selector: "gd-sync-bar",
  imports: [CdkMenu, CdkMenuTrigger, Icon, MenuItem],
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
    @if (remote(); as remote) {
      <button
        type="button"
        class="icon-btn"
        [attr.aria-label]="'Fetch from ' + remote"
        [title]="'Fetch from ' + remote"
        [disabled]="session.busy()"
        (click)="sync('fetch')"
      >
        <svg gd-icon name="refresh-cw" [size]="14"></svg>
      </button>
      <button
        type="button"
        class="icon-btn"
        [attr.aria-label]="'Pull from ' + remote"
        [title]="'Pull from ' + remote"
        [disabled]="session.busy() || !head().branch"
        (click)="sync('pull')"
      >
        <svg gd-icon name="arrow-down-to-line" [size]="14"></svg>
      </button>
      @if (head().branch && !head().upstream) {
        <button
          type="button"
          class="btn btn-ghost btn-s"
          [title]="publishTo() ? 'Push ' + head().branch + ' to ' + publishTo() + ' and track it there' : 'Choose a remote to publish to'"
          [disabled]="session.busy()"
          (click)="pushes.push()"
        >
          <svg gd-icon name="cloud-upload" [size]="14"></svg><span>Publish branch</span>
        </button>
      } @else {
        <button
          type="button"
          class="icon-btn"
          [attr.aria-label]="'Push to ' + remote"
          [title]="'Push to ' + remote"
          [disabled]="session.busy() || !head().branch"
          (click)="pushes.push()"
        >
          <svg gd-icon name="arrow-up-from-line" [size]="14"></svg>
        </button>
      }
    }
    @if (head().branch) {
      <button
        type="button"
        class="icon-btn"
        aria-label="More sync actions"
        title="More sync actions"
        [cdkMenuTriggerFor]="actions"
        #trigger="cdkMenuTriggerFor"
        [class.is-active]="trigger.isOpen()"
      >
        <svg gd-icon name="ellipsis" [size]="14"></svg>
      </button>
    }
    <ng-template #actions>
      <div class="menu" cdkMenu>
        @if (remote()) {
          <button gd-menu-item [disabled]="session.busy()" (selected)="pushes.pushTo()">
            <svg icon gd-icon name="cloud-upload" [size]="14"></svg>Push to…
          </button>
        }
        <button gd-menu-item [disabled]="!canUndo()" (selected)="resets.undoLastCommit()">
          <svg icon gd-icon name="undo-2" [size]="14"></svg>Undo last commit
        </button>
      </div>
    </ng-template>
  `,
})
export class SyncBar {
  protected readonly session = inject(Session);
  private readonly repository = inject(RepositoryActions);
  protected readonly pushes = inject(PushActions);
  protected readonly resets = inject(ResetActions);
  protected readonly head = computed(() => this.session.snapshot()!.head);
  protected readonly remote = computed(() => this.repository.remote());
  protected readonly publishTo = computed(() => publishRemote(this.session.snapshot()!.remotes));
  /** A commit to take back, and nothing in progress that a reset would get in the way of. */
  protected readonly canUndo = computed(() => !!this.head().commit && !this.session.snapshot()!.operation && !this.session.busy());

  protected sync(action: "fetch" | "pull") {
    const remote = this.remote();
    if (remote) void this.repository.sync(action, remote);
  }
}
