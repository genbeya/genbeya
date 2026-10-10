import { CdkMenu } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject, type TemplateRef, viewChild } from "@angular/core";
import {
  LucideArrowRightLeft,
  LucideCloudOff,
  LucideCloudUpload,
  LucideGitBranchPlus,
  LucideGlobe,
  LucideLink,
  LucidePencil,
  LucideTag,
  LucideTrash2,
} from "@lucide/angular";
import type { Commit } from "../../../../contracts/model";
import { Session } from "../../core/session";
import { ShareLinks } from "../../core/share-links";
import { MenuItem } from "../../ui/menu-item";
import { RepositoryActions } from "../shell/repository-actions";
import { RefActions } from "./ref-actions";
import { parseRefs, type Ref } from "./ref-chips";

/**
 * The context menu of a commit: create branches and tags there, act on the
 * branches and tags pointing at it (a group each), and copy its links. Declare it once per
 * view and point rows at it:
 * `[cdkContextMenuTriggerFor]="commitMenu.menu()" [cdkContextMenuTriggerData]="{ $implicit: commit }"`.
 */
@Component({
  selector: "gd-commit-menu",
  exportAs: "gdCommitMenu",
  imports: [
    CdkMenu,
    MenuItem,
    LucideArrowRightLeft,
    LucideCloudOff,
    LucideCloudUpload,
    LucideGitBranchPlus,
    LucideGlobe,
    LucideLink,
    LucidePencil,
    LucideTag,
    LucideTrash2,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: none" },
  template: `
    <ng-template #menu let-commit>
      <div class="menu" cdkMenu>
        <button gd-menu-item (selected)="refs.createBranch(commit)">
          <svg icon lucideGitBranchPlus [size]="14" aria-hidden="true"></svg>Create branch here…
        </button>
        <button gd-menu-item (selected)="refs.createTag(commit)">
          <svg icon lucideTag [size]="14" aria-hidden="true"></svg>Create tag here…
        </button>
        @for (ref of refsOf(commit); track ref.raw) {
          <div class="menu-separator"></div>
          @switch (ref.kind) {
            @case ("branch") {
              @if (!ref.head) {
                <button gd-menu-item (selected)="repository.switchBranch(ref.name)">
                  <svg icon lucideArrowRightLeft [size]="14" aria-hidden="true"></svg>Switch to {{ ref.name }}
                </button>
              }
              <button gd-menu-item (selected)="refs.renameBranch(ref.name)">
                <svg icon lucidePencil [size]="14" aria-hidden="true"></svg>Rename {{ ref.name }}…
              </button>
              @if (remote()) {
                <button gd-menu-item (selected)="refs.setUpstream(ref.name)">
                  <svg icon lucideCloudUpload [size]="14" aria-hidden="true"></svg>Set upstream of {{ ref.name }}…
                </button>
              }
              @if (!ref.head) {
                <button gd-menu-item [danger]="true" (selected)="refs.deleteBranch(ref.name)">
                  <svg icon lucideTrash2 [size]="14" aria-hidden="true"></svg>Delete {{ ref.name }}…
                </button>
              }
            }
            @case ("remote") {
              @if (remoteOnly(ref)) {
                <button gd-menu-item (selected)="repository.switchBranch(ref.name)">
                  <svg icon lucideArrowRightLeft [size]="14" aria-hidden="true"></svg>Check out {{ ref.name }}
                </button>
              }
              <button gd-menu-item [danger]="true" (selected)="refs.deleteRemoteBranch(ref.name)">
                <svg icon lucideCloudOff [size]="14" aria-hidden="true"></svg>Delete {{ ref.name }} on the remote…
              </button>
            }
            @case ("tag") {
              @if (remote(); as name) {
                <button gd-menu-item (selected)="refs.pushTag(ref.name)">
                  <svg icon lucideCloudUpload [size]="14" aria-hidden="true"></svg>Push tag {{ ref.name }} to {{ name }}
                </button>
              }
              <button gd-menu-item [danger]="true" (selected)="refs.deleteTag(ref.name)">
                <svg icon lucideTrash2 [size]="14" aria-hidden="true"></svg>Delete tag {{ ref.name }}…
              </button>
              @if (remote(); as name) {
                <button gd-menu-item [danger]="true" (selected)="refs.deleteRemoteTag(ref.name)">
                  <svg icon lucideCloudOff [size]="14" aria-hidden="true"></svg>Delete tag {{ ref.name }} on {{ name }}…
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
          (selected)="links.copyGitdeskLink(link(commit))"
        >
          <svg icon lucideLink [size]="14" aria-hidden="true"></svg>Copy GitDesk link
        </button>
        @if (links.webLink(link(commit))) {
          <button gd-menu-item (selected)="links.copyWebLink(link(commit))">
            <svg icon lucideGlobe [size]="14" aria-hidden="true"></svg>Copy web link
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class CommitMenu {
  readonly menu = viewChild.required<TemplateRef<{ $implicit: Commit }>>("menu");
  protected readonly refs = inject(RefActions);
  protected readonly repository = inject(RepositoryActions);
  protected readonly links = inject(ShareLinks);
  private readonly session = inject(Session);
  protected readonly remote = computed(() => (this.session.snapshot() ? this.repository.remote() : null));

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
