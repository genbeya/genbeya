/** Lucide icons as plain SVG, for the parts of CodeMirror Angular does not render (panels, gutter markers). */
import type { LucideIconData, LucideIconNode } from "@lucide/angular";

const SVG = "http://www.w3.org/2000/svg";

function append(parent: Element, nodes: readonly LucideIconNode[]) {
  for (const [tag, attributes, children] of nodes) {
    const child = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attributes)) if (name !== "key") child.setAttribute(name, String(value));
    parent.append(child);
    if (children) append(child, children);
  }
}

export function iconElement(icon: LucideIconData, size = 16): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const attributes = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 2 };
  for (const [name, value] of Object.entries(attributes)) svg.setAttribute(name, String(value));
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  append(svg, icon.node);
  return svg;
}
