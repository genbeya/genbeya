import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, computed, inject, input } from "@angular/core";
import { Router } from "@angular/router";
import {
  LucideCodeXml,
  LucideCopy,
  LucideEllipsis,
  LucideFolderInput,
  LucideGlobe,
  LucideLink,
  LucidePlus,
  LucideTrash2,
} from "@lucide/angular";
import type { LinkItem } from "../../../../contracts/gitdesk-link";
import { Clipboard } from "../../core/clipboard";
import { ShareLinks } from "../../core/share-links";
import { MenuItem } from "../../ui/menu-item";
import { WikiActions } from "./wiki-actions";

/** Actions on a page: subpage, move, copy path or links, open as code, delete. */
@Component({
  selector: "gd-page-menu",
  imports: [
    CdkMenu,
    CdkMenuTrigger,
    MenuItem,
    LucideCodeXml,
    LucideCopy,
    LucideEllipsis,
    LucideFolderInput,
    LucideGlobe,
    LucideLink,
    LucidePlus,
    LucideTrash2,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: contents" },
  template: `
    <button
      type="button"
      class="icon-btn"
      [class.tree-menu]="compact()"
      aria-label="Page actions"
      title="Page actions"
      [cdkMenuTriggerFor]="menu"
      #trigger="cdkMenuTriggerFor"
      [class.is-active]="trigger.isOpen()"
      (click)="$event.stopPropagation()"
    >
      <svg lucideEllipsis [size]="compact() ? 13 : 16" aria-hidden="true"></svg>
    </button>
    <ng-template #menu>
      <div class="menu" cdkMenu>
        <button gd-menu-item (selected)="wiki.createPage(path())">
          <svg icon lucidePlus [size]="14" aria-hidden="true"></svg>New subpage
        </button>
        <button gd-menu-item (selected)="wiki.movePage(path())">
          <svg icon lucideFolderInput [size]="14" aria-hidden="true"></svg>Move or rename…
        </button>
        <button gd-menu-item (selected)="copyPath()"><svg icon lucideCopy [size]="14" aria-hidden="true"></svg>Copy path</button>
        <button
          gd-menu-item
          [disabled]="!!links.unavailable()"
          [attr.title]="links.unavailable()"
          (selected)="links.copyGitdeskLink(item())"
        >
          <svg icon lucideLink [size]="14" aria-hidden="true"></svg>Copy GitDesk link
        </button>
        @if (links.webLink(item())) {
          <button gd-menu-item (selected)="links.copyWebLink(item())">
            <svg icon lucideGlobe [size]="14" aria-hidden="true"></svg>Copy web link
          </button>
        }
        <button gd-menu-item (selected)="openAsCode()">
          <svg icon lucideCodeXml [size]="14" aria-hidden="true"></svg>Open in code editor
        </button>
        <div class="menu-separator"></div>
        <button gd-menu-item [danger]="true" (selected)="wiki.deletePage(path())">
          <svg icon lucideTrash2 [size]="14" aria-hidden="true"></svg>Delete page…
        </button>
      </div>
    </ng-template>
  `,
})
export class PageMenu {
  readonly path = input.required<string>();
  /** The small variant shown in tree rows. */
  readonly compact = input(false);
  protected readonly wiki = inject(WikiActions);
  protected readonly links = inject(ShareLinks);
  protected readonly item = computed<LinkItem>(() => ({ kind: "page", path: this.path() }));
  private readonly router = inject(Router);
  private readonly clipboard = inject(Clipboard);

  protected copyPath() {
    void this.clipboard.copy(this.path(), "Path");
  }

  protected openAsCode() {
    void this.router.navigate(["/code"], { queryParams: { file: this.path() } });
  }
}
