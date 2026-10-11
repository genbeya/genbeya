import { CdkMenu } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, inject, type TemplateRef, viewChild } from "@angular/core";
import type { LinkItem } from "../../../../contracts/gitdesk-link";
import { ShareLinks } from "../../core/share-links";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";

/**
 * The context menu of an item: copy its GitDesk link or its web link.
 * Declare it once per view and point rows at it:
 * `[cdkContextMenuTriggerFor]="share.menu()" [cdkContextMenuTriggerData]="{ $implicit: item }"`.
 * Menus with more actions list the same two entries themselves, since CDK
 * menus only see items in their own template.
 */
@Component({
  selector: "gd-share-menu",
  exportAs: "gdShareMenu",
  imports: [CdkMenu, Icon, MenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: none" },
  template: `
    <ng-template #menu let-item>
      <div class="menu" cdkMenu>
        <button gd-menu-item [disabled]="!!links.unavailable()" [attr.title]="links.unavailable()" (selected)="links.copyGitdeskLink(item)">
          <svg icon gd-icon name="link" [size]="14"></svg>Copy GitDesk link
        </button>
        @if (links.webLink(item)) {
          <button gd-menu-item (selected)="links.copyWebLink(item)"><svg icon gd-icon name="globe" [size]="14"></svg>Copy web link</button>
        }
      </div>
    </ng-template>
  `,
})
export class ShareMenu {
  readonly menu = viewChild.required<TemplateRef<{ $implicit: LinkItem }>>("menu");
  protected readonly links = inject(ShareLinks);
}
