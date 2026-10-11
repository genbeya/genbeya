/**
 * GitDesk's icons: `<svg gd-icon name="name">` in templates, {@link iconElement}
 * for DOM that Angular does not render (CodeMirror's panels and gutters).
 * Both draw the shapes in icon-data.ts the way Lucide draws them.
 */
import { ChangeDetectionStrategy, Component, effect, ElementRef, HostAttributeToken, inject, input } from "@angular/core";
import { ICONS, type IconName } from "./icon-data";

/** An icon's elements: tag and attributes, on a 24×24 grid. */
export type IconShape = readonly (readonly [tag: string, attributes: Readonly<Record<string, string>>])[];

const SVG = "http://www.w3.org/2000/svg";

function drawShape(svg: SVGSVGElement, name: IconName) {
  svg.replaceChildren(
    ...ICONS[name].map(([tag, attributes]) => {
      const element = document.createElementNS(SVG, tag);
      for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value);
      return element;
    }),
  );
}

/** The icon as a detached SVG element, for DOM outside Angular. */
export function iconElement(name: IconName, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const attributes = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2 };
  for (const [attribute, value] of Object.entries(attributes)) svg.setAttribute(attribute, String(value));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  drawShape(svg, name);
  return svg;
}

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
