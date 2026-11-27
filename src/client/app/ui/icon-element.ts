/**
 * Genbeya's icons as SVG elements, for DOM that Angular does not render
 * (CodeMirror's panels and gutters, the kit). Draws the shapes of
 * icon-data.ts the way Lucide draws them; icon.ts is the component.
 */
import { ICONS, type IconName } from "./icon-data";

const SVG = "http://www.w3.org/2000/svg";

/** Replaces the children of `svg` with the shapes of the icon `name`. */
export function drawShape(svg: SVGSVGElement, name: IconName) {
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
