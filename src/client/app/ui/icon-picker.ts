import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, input, output } from "@angular/core";
import { LucideDynamicIcon } from "@lucide/angular";
import { ICON_NAMES, iconFor } from "./icons";
import { MenuItem } from "./menu-item";

/**
 * A button showing an icon of the curated set; it opens a grid to choose
 * another. With `noneLabel`, the menu also offers no icon (null).
 */
@Component({
  selector: "gd-icon-picker",
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, LucideDynamicIcon, MenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .icon-grid {
      display: grid;
      grid-template-columns: repeat(7, 30px);
      gap: 2px;
      min-width: 0;
    }
    .icon-grid .menu-item {
      grid-column: 1 / -1;
    }
    .icon-choice {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 0;
      border-radius: var(--radius-s);
      background: none;
      color: var(--text-2);
    }
    .icon-choice:hover,
    .icon-choice:focus {
      outline: none;
      background: var(--bg-active);
      color: var(--text);
    }
    .icon-choice.is-active {
      background: var(--accent-soft);
      color: var(--accent);
    }
  `,
  template: `
    <button
      type="button"
      class="icon-btn"
      [attr.aria-label]="label()"
      [title]="label()"
      [style.color]="color()"
      [cdkMenuTriggerFor]="menu"
      #trigger="cdkMenuTriggerFor"
      [class.is-active]="trigger.isOpen()"
    >
      @if (value()) {
        <svg [lucideIcon]="iconFor(value()!)" [size]="15" aria-hidden="true"></svg>
      } @else {
        <ng-content select="[none]" />
      }
    </button>
    <ng-template #menu>
      <div class="menu icon-grid" cdkMenu>
        @if (noneLabel()) {
          <button gd-menu-item [checked]="!value()" (selected)="changed.emit(null)">{{ noneLabel() }}</button>
        }
        @for (name of names; track name) {
          <button
            type="button"
            class="icon-choice"
            cdkMenuItem
            [attr.aria-label]="readable(name)"
            [title]="readable(name)"
            [class.is-active]="name === value()"
            (cdkMenuItemTriggered)="changed.emit(name)"
          >
            <svg [lucideIcon]="iconFor(name)" [size]="15" aria-hidden="true"></svg>
          </button>
        }
      </div>
    </ng-template>
  `,
})
export class IconPicker {
  /** The icon's Lucide name; null for none. */
  readonly value = input.required<string | null>();
  readonly label = input.required<string>();
  readonly color = input<string>();
  /** Offers no icon under this name, showing the projected `[none]` content meanwhile. */
  readonly noneLabel = input<string>();
  readonly changed = output<string | null>();
  protected readonly names = ICON_NAMES;
  protected readonly iconFor = iconFor;

  /** "circle-check" → "Circle check". */
  protected readable(name: string): string {
    return name.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
  }
}
