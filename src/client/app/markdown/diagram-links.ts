/**
 * Tasks in diagrams: a click on a diagram finds the label under the pointer,
 * and a label that names a task by its ID opens the task. Diagrams are
 * pictures (an `img` of the SVG), so the labels are measured on a hidden
 * copy of the SVG laid out at the picture's size.
 */

const ID = /\b[A-Z][A-Z0-9]*-\d+\b/gi;

/** The first task `text` names, by its ID; null for none. */
export function namedTask<T>(text: string, tasks: ReadonlyMap<string, T>): T | null {
  for (const match of text.matchAll(ID)) {
    const task = tasks.get(match[0].toUpperCase());
    if (task) return task;
  }
  return null;
}

/** Whether the SVG names any of the tasks at all, so a click may be one on a task. */
export const mentionsTasks = (svg: string, tasks: ReadonlyMap<string, unknown>): boolean => namedTask(svg, tasks) !== null;

/** The SVG without anything that runs or loads, for measuring. */
function inert(svg: string): SVGSVGElement | null {
  // Read as HTML: Mermaid's labels are HTML, which isn't always well-formed XML.
  const root = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
  if (!(root instanceof SVGSVGElement)) return null;
  for (const element of [...root.querySelectorAll("script, image, use, a, iframe")]) element.remove();
  for (const element of [root, ...root.querySelectorAll("*")])
    for (const attribute of [...element.attributes])
      if (/^on|^(xlink:)?href$/i.test(attribute.name)) element.removeAttribute(attribute.name);
  return root;
}

/** Where a task's label lies in a picture, in pixels from its top left corner. */
export interface TaskBox<T> {
  readonly task: T;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The labels that name tasks when the picture shows `svg` at `width` × `height`, measured on a hidden copy. */
export function taskBoxes<T>(svg: string, width: number, height: number, tasks: ReadonlyMap<string, T>): TaskBox<T>[] {
  const root = inert(svg);
  if (!root) return [];
  // A picture scales the SVG to its box as its view box says; without one, the SVG's own size is the box.
  if (!root.getAttribute("viewBox")) {
    const [w, h] = [parseFloat(root.getAttribute("width") ?? ""), parseFloat(root.getAttribute("height") ?? "")];
    if (w > 0 && h > 0) root.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  const holder = document.createElement("div");
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = `position:fixed;left:-100000px;top:0;width:${width}px;height:${height}px;visibility:hidden;pointer-events:none;`;
  holder.append(root);
  document.body.append(holder);
  try {
    const origin = root.getBoundingClientRect();
    const boxes: TaskBox<T>[] = [];
    for (const element of root.querySelectorAll("text, foreignObject div, foreignObject span")) {
      const task = namedTask(element.textContent ?? "", tasks);
      if (!task) continue;
      const box = element.getBoundingClientRect();
      boxes.push({ task, left: box.left - origin.left, top: box.top - origin.top, width: box.width, height: box.height });
    }
    return boxes;
  } finally {
    holder.remove();
  }
}

/** The task whose label is under `point` (with a little room around labels), the smallest one where they nest. */
export function boxAt<T>(boxes: readonly TaskBox<T>[], point: { x: number; y: number }): T | null {
  let best: TaskBox<T> | null = null;
  for (const box of boxes) {
    const inside =
      point.x >= box.left - 4 && point.x <= box.left + box.width + 4 && point.y >= box.top - 4 && point.y <= box.top + box.height + 4;
    if (inside && (!best || box.width * box.height < best.width * best.height)) best = box;
  }
  return best?.task ?? null;
}
