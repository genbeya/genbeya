import { CdkMenuItem } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, input } from "@angular/core";
import { Icon } from "./icon";

/**
 * A row of a CDK menu: `<button gd-menu-item (selected)="…">`.
 * Project an icon with the `icon` attribute; `checked` replaces it with a tick.
 */
@Component({
  selector: "button[gd-menu-item]",
  imports: [Icon],
  hostDirectives: [{ directive: CdkMenuItem, inputs: ["cdkMenuItemDisabled: disabled"], outputs: ["cdkMenuItemTriggered: selected"] }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { type: "button", class: "menu-item", "[class.is-danger]": "danger()" },
  template: `
    <span class="menu-icon">
      @if (checked()) {
        <svg gd-icon name="check" [size]="14"></svg>
      } @else {
        <ng-content select="[icon]" />
      }
    </span>
    <span class="grow ellipsis"
      ><ng-content />
      @if (checked()) {
        <span class="sr-only"> (selected)</span>
      }
    </span>
    @if (hint()) {
      <span class="menu-hint">{{ hint() }}</span>
    }
  `,
})
export class MenuItem {
  readonly checked = input<boolean | undefined>(undefined);
  readonly danger = input(false);
  readonly hint = input<string>();
}
