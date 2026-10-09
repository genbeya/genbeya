import { CdkMenu, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, inject, input } from "@angular/core";
import { Router } from "@angular/router";
import { LucideCodeXml, LucideCopy, LucideEllipsis, LucideFolderInput, LucidePlus, LucideTrash2 } from "@lucide/angular";
import { Notifications } from "../../core/notifications";
import { MenuItem } from "../../ui/menu-item";
import { WikiActions } from "./wiki-actions";

/** Actions on a page: subpage, move, copy path, open as code, delete. */
@Component({
  selector: "gd-page-menu",
  imports: [CdkMenu, CdkMenuTrigger, MenuItem, LucideCodeXml, LucideCopy, LucideEllipsis, LucideFolderInput, LucidePlus, LucideTrash2],
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
        <button gd-menu-item (selected)="wiki.createPage(path())"><svg icon lucidePlus [size]="14" aria-hidden="true"></svg>New subpage</button>
        <button gd-menu-item (selected)="wiki.movePage(path())"><svg icon lucideFolderInput [size]="14" aria-hidden="true"></svg>Move or rename…</button>
        <button gd-menu-item (selected)="copyPath()"><svg icon lucideCopy [size]="14" aria-hidden="true"></svg>Copy path</button>
        <button gd-menu-item (selected)="openAsCode()"><svg icon lucideCodeXml [size]="14" aria-hidden="true"></svg>Open in code editor</button>
        <div class="menu-separator"></div>
        <button gd-menu-item [danger]="true" (selected)="wiki.deletePage(path())"><svg icon lucideTrash2 [size]="14" aria-hidden="true"></svg>Delete page…</button>
      </div>
    </ng-template>
  `,
})
export class PageMenu {
  readonly path = input.required<string>();
  /** The small variant shown in tree rows. */
  readonly compact = input(false);
  protected readonly wiki = inject(WikiActions);
  private readonly router = inject(Router);
  private readonly notifications = inject(Notifications);

  protected copyPath() {
    void navigator.clipboard?.writeText(this.path());
    this.notifications.success("Path copied");
  }

  protected openAsCode() {
    void this.router.navigate(["/code"], { queryParams: { file: this.path() } });
  }
}
