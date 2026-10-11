import { CdkMenu } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, inject, output, type TemplateRef, viewChild } from "@angular/core";
import { extensionOf } from "../../../../utilities/gitignore";
import { baseName, parentOf } from "../../../../utilities/repository-path";
import { Icon } from "../../ui/icon";
import { MenuItem } from "../../ui/menu-item";
import { ChangeActions } from "./change-actions";
import { untracked, type ChangeTarget } from "./change-target";

/**
 * The context menu of changed files and folders: stage, unstage or discard
 * them, open a file, add it, its folder or its extension to .gitignore,
 * and stop tracking it. Declare it once and point rows at it:
 * `[cdkContextMenuTriggerFor]="changeMenu.menu()" [cdkContextMenuTriggerData]="{ $implicit: target }"`.
 */
@Component({
  selector: "gd-change-menu",
  exportAs: "gdChangeMenu",
  imports: [CdkMenu, Icon, MenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { style: "display: none" },
  template: `
    <ng-template #menu let-target>
      <div class="menu" cdkMenu>
        @if (target.staged) {
          <button gd-menu-item (selected)="actions.unstage(paths(target))"><svg icon gd-icon name="minus" [size]="14"></svg>Unstage</button>
        } @else {
          <button gd-menu-item (selected)="actions.stage(paths(target))"><svg icon gd-icon name="plus" [size]="14"></svg>Stage</button>
          <button gd-menu-item [danger]="true" (selected)="actions.discard(paths(target), target.folder ? target.path : undefined)">
            <svg icon gd-icon name="undo-2" [size]="14"></svg>Discard changes…
          </button>
        }
        @if (!target.folder) {
          <button gd-menu-item (selected)="openFile.emit(target.path)">
            <svg icon gd-icon name="file-code-2" [size]="14"></svg>Open file
          </button>
        }
        <div class="menu-separator"></div>
        @if (target.folder) {
          <button gd-menu-item (selected)="actions.ignore(target.path, 'folder', !isUntracked(target))">
            <svg icon gd-icon name="eye-off" [size]="14"></svg>Ignore folder {{ target.path }}…
          </button>
        } @else {
          <button gd-menu-item (selected)="actions.ignore(target.path, 'file', !isUntracked(target))">
            <svg icon gd-icon name="eye-off" [size]="14"></svg>Ignore file {{ name(target.path) }}…
          </button>
          @if (parent(target.path); as folder) {
            <button gd-menu-item (selected)="actions.ignore(folder, 'folder', !isUntracked(target))">
              <svg icon gd-icon name="eye-off" [size]="14"></svg>Ignore folder {{ folder }}…
            </button>
          }
          @if (extension(target.path); as extension) {
            <button gd-menu-item (selected)="actions.ignore(target.path, 'extension', !isUntracked(target))">
              <svg icon gd-icon name="eye-off" [size]="14"></svg>Ignore all *.{{ extension }} files…
            </button>
          }
        }
        @if (!isUntracked(target)) {
          <button gd-menu-item [danger]="true" (selected)="actions.untrack(target.path, target.folder)">
            <svg icon gd-icon name="file-minus" [size]="14"></svg>Stop tracking…
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class ChangeMenu {
  readonly menu = viewChild.required<TemplateRef<unknown>>("menu");
  readonly openFile = output<string>();
  protected readonly actions = inject(ChangeActions);
  protected readonly name = baseName;
  protected readonly parent = parentOf;
  protected readonly extension = extensionOf;
  protected readonly isUntracked = untracked;

  protected paths(target: ChangeTarget): string[] {
    return target.changes.map((change) => change.path);
  }
}
