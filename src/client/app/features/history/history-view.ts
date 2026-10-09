import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, ViewEncapsulation } from "@angular/core";
import { Router } from "@angular/router";
import { LucideGitCommitHorizontal } from "@lucide/angular";
import type { Commit } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { EmptyState } from "../../ui/empty-state";
import { Resizable, ResizeHandle } from "../../ui/resizable";
import { layoutGraph, relativeTime } from "./commit-graph";
import { CommitPane } from "./commit-pane";
import { GraphLines, LANE_WIDTH } from "./graph-lines";
import { RefChips } from "./ref-chips";

const PAGE = 200;
/** Wider graphs are cut off; a dozen lanes is plenty to follow. */
const MAX_LANES = 12;

/**
 * Every branch's commits as a graph, and the selected commit (`?commit=&file=`).
 * Styles are global but namespaced, so the feature's sub-components share them.
 */
@Component({
  selector: "gd-history-view",
  imports: [CommitPane, EmptyState, GraphLines, RefChips, Resizable, ResizeHandle, LucideGitCommitHorizontal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  styleUrl: "./history.css",
  host: { class: "view" },
  template: `
    @if (error(); as message) {
      <gd-empty-state title="Can't read history"
        ><p class="selectable">{{ message }}</p></gd-empty-state
      >
    } @else if (!commits()) {
      <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
    } @else if (!commits()!.length) {
      <gd-empty-state title="No commits yet">
        <svg icon lucideGitCommitHorizontal [size]="20" aria-hidden="true"></svg>
        <p>Commit your first changes in Changes.</p>
      </gd-empty-state>
    } @else {
      <div class="view-body">
        <aside class="side-panel history-list" gdResizable="history" [initial]="520" [min]="340" [max]="900" #panel="gdResizable">
          <div class="side-panel-scroll" role="list" aria-label="Commits">
            @for (row of graph().rows; track row.commit.hash) {
              <button
                type="button"
                role="listitem"
                class="history-row"
                [class.is-selected]="row.commit.hash === commit()"
                [attr.aria-current]="row.commit.hash === commit() || null"
                (click)="select(row.commit.hash)"
              >
                <gd-graph-lines [row]="row" [width]="graphWidth()" />
                <span class="history-text">
                  <span class="history-subject ellipsis"><gd-ref-chips [refs]="row.commit.refs" />{{ row.commit.subject }}</span>
                  <span class="history-meta ellipsis">{{ row.commit.author }} · {{ relativeTime(row.commit.date) }}</span>
                </span>
              </button>
            }
            @if (more()) {
              <div class="history-more">
                <button type="button" class="btn btn-ghost btn-s" [disabled]="loading()" (click)="load(commits()!.length)">
                  <span>Load older commits</span>
                </button>
              </div>
            }
          </div>
        </aside>
        <div [gdResizeHandle]="panel"></div>
        <section class="main-pane">
          @if (commit(); as hash) {
            @for (key of [hash]; track key) {
              <gd-commit-pane [hash]="hash" [file]="file()" />
            }
          }
        </section>
      </div>
    }
  `,
})
export class HistoryView {
  readonly commit = input<string>();
  readonly file = input<string>();

  private readonly session = inject(Session);
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly relativeTime = relativeTime;
  protected readonly commits = signal<readonly Commit[] | null>(null);
  protected readonly more = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly loading = signal(false);
  /** Counts loads, so a reload after a branch moved wins over an older page still loading. */
  private ticket = 0;
  protected readonly graph = computed(() => layoutGraph(this.commits() ?? []));
  protected readonly graphWidth = computed(() => Math.min(this.graph().lanes, MAX_LANES) * LANE_WIDTH + 12);
  /** Changes when HEAD or any branch moves. */
  private readonly refsKey = computed(() => {
    const snapshot = this.session.snapshot()!;
    return [snapshot.head.commit, ...snapshot.branches, ...snapshot.remoteBranches].join("\n");
  });

  constructor() {
    effect(() => {
      this.refsKey();
      untracked(() => void this.load(0));
    });
    effect(() => {
      const first = this.commits()?.[0];
      if (first && !this.commit()) untracked(() => this.select(first.hash));
    });
  }

  protected async load(skip: number) {
    const ticket = ++this.ticket;
    this.loading.set(true);
    try {
      const page = await this.api.versionControl.log(skip, PAGE);
      if (ticket !== this.ticket) return;
      this.commits.update((loaded) => (skip ? [...(loaded ?? []), ...page] : page));
      this.more.set(page.length === PAGE);
      this.error.set(null);
    } catch (failure) {
      if (ticket === this.ticket) this.error.set(messageOf(failure));
    } finally {
      if (ticket === this.ticket) this.loading.set(false);
    }
  }

  protected select(commit: string) {
    void this.router.navigate(["/history"], { queryParams: { commit }, replaceUrl: true });
  }
}
