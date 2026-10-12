import { CdkMenu } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject, input, type TemplateRef, viewChild } from "@angular/core";
import type { Commit } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { ShareLinks } from "../../core/share-links";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";
import { OperationActions } from "../operations/operation-actions";
import { PushActions } from "../push/push-actions";
import { RepositoryActions } from "../shell/repository-actions";
import { RefActions } from "./ref-actions";
import { ResetActions } from "./reset-actions";
import { parseRefs, type Ref } from "./ref-chips";

/**
 * The context menu of a commit: create branches and tags there; cherry-pick,
 * revert, rebase interactively from it or reset the current branch to it;
 * act on the branches and tags pointing at it (a group each: merge, rebase,
 * switch, rename, push, delete…); and copy its links. Declare it once per view and point rows at it:
 * `[cdkContextMenuTriggerFor]="commitMenu.menu()" [cdkContextMenuTriggerData]="{ $implicit: commit }"`.
 */
@Component({
  selector: "gd-commit-menu",
  exportAs: "gdCommitMenu",
  imports: [CdkMenu, Icon, MenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: none" },
  template: `
    <ng-template #menu let-commit>
      <div class="menu" cdkMenu>
        <button gd-menu-item (selected)="refs.createBranch(commit)">
          <svg icon gd-icon name="git-branch-plus" [size]="14"></svg>Create branch here…
        </button>
        <button gd-menu-item (selected)="refs.createTag(commit)"><svg icon gd-icon name="tag" [size]="14"></svg>Create tag here…</button>
        @if (current(); as branch) {
          <div class="menu-separator"></div>
          @if (commit.parents.length < 2) {
            <!-- A commit the branch contains already has nothing to bring. -->
            @if (!onHead().has(commit.hash)) {
              <button gd-menu-item (selected)="operations.cherryPick(commit)">
                <svg icon gd-icon name="cherry" [size]="14"></svg>Cherry-pick onto {{ branch }}
              </button>
            }
            <button gd-menu-item (selected)="operations.revert(commit)"><svg icon gd-icon name="undo-2" [size]="14"></svg>Revert…</button>
          }
          <button gd-menu-item (selected)="operations.rebaseInteractive(commit)">
            <svg icon gd-icon name="list-restart" [size]="14"></svg>Rebase interactively from here…
          </button>
          <button gd-menu-item (selected)="resets.resetTo(commit)">
            <svg icon gd-icon name="history" [size]="14"></svg>Reset {{ branch }} to here…
          </button>
        }
        @for (ref of refsOf(commit); track ref.raw) {
          <div class="menu-separator"></div>
          @if (!ref.head && current(); as branch) {
            <button gd-menu-item (selected)="operations.merge(ref.name, ref.kind)">
              <svg icon gd-icon name="git-merge" [size]="14"></svg>Merge {{ ref.name }} into {{ branch }}…
            </button>
            <button gd-menu-item (selected)="operations.rebase(ref.name)">
              <svg icon gd-icon name="git-pull-request-arrow" [size]="14"></svg>Rebase {{ branch }} onto {{ ref.name }}…
            </button>
          }
          @switch (ref.kind) {
            @case ("branch") {
              @if (!ref.head) {
                <button gd-menu-item (selected)="repository.switchBranch(ref.name)">
                  <svg icon gd-icon name="arrow-right-left" [size]="14"></svg>Switch to {{ ref.name }}
                </button>
              }
              <button gd-menu-item (selected)="refs.renameBranch(ref.name)">
                <svg icon gd-icon name="pencil" [size]="14"></svg>Rename {{ ref.name }}…
              </button>
              @if (remote()) {
                <button gd-menu-item (selected)="refs.setUpstream(ref.name)">
                  <svg icon gd-icon name="cloud-upload" [size]="14"></svg>Set upstream of {{ ref.name }}…
                </button>
                <button gd-menu-item (selected)="pushes.pushTo(ref.name)">
                  <svg icon gd-icon name="arrow-up-from-line" [size]="14"></svg>Push {{ ref.name }} to…
                </button>
              }
              @if (!ref.head) {
                <button gd-menu-item [danger]="true" (selected)="refs.deleteBranch(ref.name)">
                  <svg icon gd-icon name="trash-2" [size]="14"></svg>Delete {{ ref.name }}…
                </button>
              }
            }
            @case ("remote") {
              @if (remoteOnly(ref)) {
                <button gd-menu-item (selected)="repository.switchBranch(ref.name)">
                  <svg icon gd-icon name="arrow-right-left" [size]="14"></svg>Check out {{ ref.name }}
                </button>
              }
              <button gd-menu-item [danger]="true" (selected)="refs.deleteRemoteBranch(ref.name)">
                <svg icon gd-icon name="cloud-off" [size]="14"></svg>Delete {{ ref.name }} on the remote…
              </button>
            }
            @case ("tag") {
              @if (remote(); as name) {
                <button gd-menu-item (selected)="refs.pushTag(ref.name)">
                  <svg icon gd-icon name="cloud-upload" [size]="14"></svg>Push tag {{ ref.name }} to {{ name }}
                </button>
              }
              <button gd-menu-item [danger]="true" (selected)="refs.deleteTag(ref.name)">
                <svg icon gd-icon name="trash-2" [size]="14"></svg>Delete tag {{ ref.name }}…
              </button>
              @if (remote(); as name) {
                <button gd-menu-item [danger]="true" (selected)="refs.deleteRemoteTag(ref.name)">
                  <svg icon gd-icon name="cloud-off" [size]="14"></svg>Delete tag {{ ref.name }} on {{ name }}…
                </button>
              }
            }
          }
        }
        <div class="menu-separator"></div>
        <button
          gd-menu-item
          [disabled]="!!links.unavailable()"
          [attr.title]="links.unavailable()"
          (selected)="links.copyGenbeyaLink(link(commit))"
        >
          <svg icon gd-icon name="link" [size]="14"></svg>Copy Genbeya link
        </button>
        @if (links.webLink(link(commit))) {
          <button gd-menu-item (selected)="links.copyWebLink(link(commit))">
            <svg icon gd-icon name="globe" [size]="14"></svg>Copy web link
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class CommitMenu {
  /** Hashes of commits HEAD contains, as far as the view knows them; they are not offered for cherry-picking. */
  readonly onHead = input<ReadonlySet<string>>(new Set());
  readonly menu = viewChild.required<TemplateRef<{ $implicit: Commit }>>("menu");
  protected readonly refs = inject(RefActions);
  protected readonly repository = inject(RepositoryActions);
  protected readonly operations = inject(OperationActions);
  protected readonly resets = inject(ResetActions);
  protected readonly pushes = inject(PushActions);
  protected readonly links = inject(ShareLinks);
  private readonly session = inject(Session);
  protected readonly remote = computed(() => this.repository.remote());
  /** The branch to merge, pick or rebase into; none while another operation is in progress. */
  protected readonly current = computed(() => (this.session.snapshot()?.operation ? null : this.session.snapshot()?.head.branch));

  /** The refs to act on: a detached HEAD and remote HEADs are not. */
  protected refsOf(commit: Commit): Ref[] {
    return parseRefs(commit.refs, this.session.snapshot()?.branches ?? []).filter(
      (ref) => ref.name !== "HEAD" && !ref.name.endsWith("/HEAD"),
    );
  }

  protected remoteOnly(ref: Ref): boolean {
    return !!this.session.snapshot()?.remoteBranches.includes(ref.name);
  }

  protected link(commit: Commit) {
    return { kind: "commit", hash: commit.hash } as const;
  }
}
