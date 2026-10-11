import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import type { Stash, StashDetail } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { relativeTime } from "../../ui/relative-time";
import { DiffPane } from "../diff/diff-pane";
import { StashActions } from "./stash-actions";

/** A stash: its message, actions, files, and the selected file's diff. */
@Component({
  selector: "gd-stash-pane",
  imports: [DiffPane, EmptyState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: "./stash-pane.css",
  host: { class: "view" },
  template: `
    <div class="stash-head">
      <h2 class="selectable">{{ stash().message || "Stash" }}</h2>
      <div class="stash-meta faint">{{ ref() }} · {{ stash().branch ?? "detached HEAD" }} · {{ relativeTime(stash().date) }}</div>
      <div class="stash-actions">
        <button type="button" class="btn btn-primary btn-s" [disabled]="session.busy()" (click)="actions.apply(stash(), true)">
          <svg gd-icon name="archive-restore" [size]="14"></svg><span>Pop</span>
        </button>
        <button type="button" class="btn btn-default btn-s" [disabled]="session.busy()" (click)="actions.apply(stash(), false)">
          <span>Apply</span>
        </button>
        <button type="button" class="btn btn-default btn-s" [disabled]="session.busy()" (click)="actions.branch(stash())">
          <svg gd-icon name="git-branch-plus" [size]="14"></svg><span>Branch…</span>
        </button>
        <span class="grow"></span>
        <button type="button" class="btn btn-ghost btn-s" [disabled]="session.busy()" (click)="actions.drop(stash())">
          <svg gd-icon name="trash-2" [size]="14"></svg><span>Drop…</span>
        </button>
      </div>
      <div class="stash-files" role="list" aria-label="Stashed files">
        @for (stashed of detail()?.files ?? []; track stashed.commit + stashed.path) {
          <button
            type="button"
            role="listitem"
            class="stash-file"
            [class.is-selected]="stashed.path === file()"
            (click)="selectFile(stashed.path)"
          >
            <span class="status-letter {{ stashed.status }}">{{ stashed.status }}</span
            ><span class="ellipsis">{{ stashed.path }}</span>
          </button>
        }
      </div>
    </div>
    @if (error(); as message) {
      <gd-empty-state title="Can't read this stash"
        ><p class="selectable">{{ message }}</p></gd-empty-state
      >
    } @else if (selected(); as stashed) {
      @for (key of [stashed.commit + stashed.path]; track key) {
        <gd-diff-pane [path]="stashed.path" [badge]="stashed.commit === stash().hash ? 'Stashed' : 'Untracked'" [load]="loadDiff()" />
      }
    }
  `,
})
export class StashPane {
  readonly stash = input.required<Stash>();
  readonly file = input<string>();

  protected readonly session = inject(Session);
  protected readonly actions = inject(StashActions);
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly relativeTime = relativeTime;
  protected readonly detail = signal<StashDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly ref = computed(() => `stash@{${this.stash().index}}`);
  protected readonly selected = computed(() => this.detail()?.files.find((stashed) => stashed.path === this.file()));
  protected readonly loadDiff = computed(() => {
    const stashed = this.selected()!;
    return () => this.api.versionControl.diff(stashed.path, { commit: stashed.commit }, stashed.oldPath);
  });

  constructor() {
    effect(() => {
      const hash = this.stash().hash;
      untracked(() => void this.load(hash));
    });
    effect(() => {
      const first = this.detail()?.files[0];
      if (first && !this.selected()) untracked(() => this.selectFile(first.path));
    });
  }

  private async load(hash: string) {
    try {
      this.detail.set(await this.api.versionControl.stashDetail(hash));
      this.error.set(null);
    } catch (failure) {
      this.error.set(messageOf(failure));
    }
  }

  protected selectFile(file: string) {
    void this.router.navigate(["/changes"], { queryParams: { stash: this.stash().hash, file }, replaceUrl: true });
  }
}
