import { CdkContextMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { Router } from "@angular/router";
import type { CommitDetail } from "../../../../contracts/model";
import { messageOf } from "../../core/notifications";
import { Clipboard } from "../../core/clipboard";
import { Session } from "../../core/session";
import { WorkspaceApi } from "../../core/workspace-api";
import { Avatar } from "../../ui/avatar";
import { EmptyState } from "../../ui/empty-state";
import { Icon } from "../../ui/icon";
import { relativeTime } from "../../ui/relative-time";
import { DiffPane } from "../diff/diff-pane";
import { CommitMenu } from "./commit-menu";
import { RefChips } from "./ref-chips";

/** A commit: message, author, files, and the selected file's diff against the (first) parent. */
@Component({
  selector: "gd-commit-pane",
  imports: [Avatar, CdkContextMenuTrigger, CommitMenu, DiffPane, EmptyState, Icon, RefChips],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "view" },
  template: `
    @if (error(); as message) {
      <gd-empty-state title="Can't read this commit"
        ><p class="selectable">{{ message }}</p></gd-empty-state
      >
    } @else if (detail(); as detail) {
      <gd-commit-menu #commitMenu="gdCommitMenu" />
      <div class="commit-head" [cdkContextMenuTriggerFor]="commitMenu.menu()" [cdkContextMenuTriggerData]="{ $implicit: detail.commit }">
        <div class="commit-title selectable">
          @if (detail.commit.parents.length > 1) {
            <svg gd-icon name="git-merge" [size]="16" class="faint" aria-label="Merge commit"></svg>
          }
          <h2>{{ detail.commit.subject }}</h2>
        </div>
        @if (detail.body) {
          <pre class="commit-body selectable">{{ detail.body }}</pre>
        }
        <div class="commit-meta">
          <gd-avatar [name]="detail.commit.author" [size]="18" />
          <span [title]="detail.commit.email">{{ detail.commit.author }}</span>
          <span class="faint" [title]="localTime(detail.commit.date)">{{ relativeTime(detail.commit.date) }}</span>
          <span class="grow"></span>
          <gd-ref-chips [refs]="detail.commit.refs" />
          <button type="button" class="hash-chip mono" title="Copy commit ID" (click)="copyHash(detail.commit.hash)">
            {{ detail.commit.hash.slice(0, 8) }}<svg gd-icon name="copy" [size]="11"></svg>
          </button>
        </div>
        <div class="commit-files" role="list" aria-label="Changed files">
          @for (changed of detail.files; track changed.path) {
            <button
              type="button"
              role="listitem"
              class="commit-file"
              [class.is-selected]="changed.path === file()"
              [title]="changed.oldPath ? changed.oldPath + ' → ' + changed.path : changed.path"
              (click)="selectFile(changed.path)"
            >
              <span class="status-letter {{ changed.status }}">{{ changed.status }}</span
              ><span class="ellipsis">{{ changed.path }}</span>
            </button>
          } @empty {
            <p class="faint">No file changes.</p>
          }
        </div>
      </div>
      @if (selected(); as changed) {
        <div class="commit-diff">
          @for (key of [changed.path]; track key) {
            <gd-diff-pane
              [path]="changed.path"
              [badge]="detail.commit.parents.length > 1 ? 'vs. first parent' : undefined"
              [load]="loadDiff()"
              [loadImages]="loadImages()"
            >
              <button type="button" class="icon-btn" aria-label="Open in code" title="Open in code" (click)="openFile(changed.path)">
                <svg gd-icon name="code-xml" [size]="15"></svg>
              </button>
            </gd-diff-pane>
          }
        </div>
      }
    } @else {
      <div class="editor-loading"><span class="spinner" aria-label="Loading"></span></div>
    }
  `,
})
export class CommitPane {
  readonly hash = input.required<string>();
  readonly file = input<string>();

  private readonly api = inject(WorkspaceApi);
  private readonly session = inject(Session);
  /**
   * What can change the refs shown on this commit: HEAD being on it, and the
   * branches and tags there are. New commits elsewhere change none of them.
   */
  private readonly refs = computed(() => {
    const snapshot = this.session.snapshot();
    // The snapshot names HEAD by its short hash.
    const at = snapshot?.head.commit && this.hash().startsWith(snapshot.head.commit);
    const head = at ? `HEAD ${snapshot.head.branch}` : "";
    return [head, ...(snapshot?.branches ?? []), ...(snapshot?.tags ?? [])].join(" ");
  });
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);
  protected readonly relativeTime = relativeTime;
  protected readonly detail = signal<CommitDetail | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly selected = computed(() => this.detail()?.files.find((changed) => changed.path === this.file()));
  protected readonly loadDiff = computed(() => {
    const changed = this.selected();
    const hash = this.hash();
    return () => this.api.versionControl.diff(changed!.path, { commit: hash }, changed?.oldPath);
  });
  protected readonly loadImages = computed(() => {
    const changed = this.selected();
    const hash = this.hash();
    return () => this.api.versionControl.diffImages(changed!.path, { commit: hash }, changed?.oldPath);
  });

  constructor() {
    effect(() => {
      const hash = this.hash();
      // Branches and tags pointing here may change.
      this.refs();
      untracked(() => void this.load(hash));
    });
    // Without a file, show the first one.
    effect(() => {
      const first = this.detail()?.files[0];
      if (first && !this.file()) untracked(() => this.selectFile(first.path));
    });
  }

  private async load(hash: string) {
    try {
      this.detail.set(await this.api.versionControl.commitDetail(hash));
    } catch (failure) {
      this.error.set(messageOf(failure));
    }
  }

  protected selectFile(file: string) {
    void this.router.navigate(["/history"], { queryParams: { commit: this.hash(), file }, replaceUrl: true });
  }

  protected openFile(file: string) {
    void this.router.navigate(["/code"], { queryParams: { file } });
  }

  protected copyHash(hash: string) {
    void this.clipboard.copy(hash, "Commit ID");
  }

  protected localTime(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
