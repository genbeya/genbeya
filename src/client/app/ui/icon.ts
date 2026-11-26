/**
 * Genbeya's icons: `<svg gd-icon name="name">` in templates. For DOM that
 * Angular does not render, `iconElement` of icon-element.ts draws the same shapes.
 */
import { ChangeDetectionStrategy, Component, effect, ElementRef, HostAttributeToken, inject, input } from "@angular/core";
import type { IconName } from "./icon-data";
import { drawShape } from "./icon-element";

export { iconElement } from "./icon-element";

/** An icon's elements: tag and attributes, on a 24×24 grid. */
export type IconShape = readonly (readonly [tag: string, attributes: Readonly<Record<string, string>>])[];

/** An icon by name; hidden from screen readers unless it has an `aria-label`. */
@Component({
  selector: "svg[gd-icon]",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "lucide",
    "[class]": "'lucide-' + name()",
    viewBox: "0 0 24 24",
    fill: "none",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "[attr.aria-hidden]": "label ? null : true",
    "[attr.role]": "label ? 'img' : null",
    "[attr.width]": "size()",
    "[attr.height]": "size()",
    "[attr.stroke]": "color()",
    "[attr.stroke-width]": "strokeWidth()",
  },
  template: "",
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(24);
  readonly color = input("currentColor");
  readonly strokeWidth = input(2);
  protected readonly label = inject(new HostAttributeToken("aria-label"), { optional: true });

  constructor() {
    const svg = inject<ElementRef<SVGSVGElement>>(ElementRef).nativeElement;
    effect(() => drawShape(svg, this.name()));
  }
}
