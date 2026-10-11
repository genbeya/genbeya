import { CdkMenu, CdkMenuItemRadio, CdkMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component, input, output, viewChild } from "@angular/core";
import { Icon } from "./icon";
import { ICON_NAMES, iconFor } from "./icons";
import { MenuItem } from "./menu-item";

/** Icons per row of the grid. */
const COLUMNS = 7;

/**
 * A button showing an icon of the curated set; it opens a grid to choose
 * another, with the arrow keys moving through rows and columns. With
 * `noneLabel`, the menu also offers no icon (null).
 */
@Component({
  selector: "gd-icon-picker",
  imports: [CdkMenu, CdkMenuItemRadio, CdkMenuTrigger, Icon, MenuItem],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .icon-grid {
      display: grid;
      grid-template-columns: repeat(var(--columns), 30px);
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
        <svg gd-icon [name]="iconFor(value()!)" [size]="15"></svg>
      } @else {
        <ng-content select="[none]" />
      }
    </button>
    <ng-template #menu>
      <div class="menu icon-grid" cdkMenu [style.--columns]="columns">
        @if (noneLabel()) {
          <button gd-menu-item [checked]="!value()" (selected)="changed.emit(null)">{{ noneLabel() }}</button>
        }
        @for (name of names; track name; let index = $index) {
          <button
            type="button"
            class="icon-choice"
            cdkMenuItemRadio
            [cdkMenuItemChecked]="name === value()"
            [attr.aria-label]="readable(name)"
            [title]="readable(name)"
            [class.is-active]="name === value()"
            (keydown)="gridKey($event, index)"
            (cdkMenuItemTriggered)="changed.emit(name)"
          >
            <svg gd-icon [name]="name" [size]="15"></svg>
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
  protected readonly columns = COLUMNS;
  private readonly menu = viewChild(CdkMenu);

  /**
   * Left and right move by one icon, up and down by a row; up from the first
   * row goes to the no-icon item. The menu itself only knows up and down.
   */
  protected gridKey(event: KeyboardEvent, index: number) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -COLUMNS, ArrowDown: COLUMNS }[event.key];
    if (step === undefined || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    const none = this.noneLabel() ? 1 : 0;
    const target = index + step;
    if (target >= 0 && target < this.names.length) this.menu()?.setActiveMenuItem(none + target);
    else if (target < 0 && none && event.key === "ArrowUp") this.menu()?.setActiveMenuItem(0);
  }

  /** "circle-check" → "Circle check". */
  protected readable(name: string): string {
    return name.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());
  }
}
