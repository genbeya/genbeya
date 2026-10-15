/**
 * Where a scrolled page of rendered Markdown is, as a line of its source:
 * blocks carry the line they start at (`data-line`, see markdown-dom.ts), and
 * positions between two blocks are interpolated. The editor and the page
 * translate their scroll positions through it, so switching between them,
 * or scrolling one beside the other, keeps the same place.
 */

interface Mark {
  readonly line: number;
  /** From the top of the scrolled content. */
  readonly top: number;
}

/** The blocks below `scroller` with their source lines, in order. */
function marks(scroller: HTMLElement): Mark[] {
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop;
  const found: Mark[] = [];
  for (const element of scroller.querySelectorAll<HTMLElement>("[data-line]")) {
    const line = Number(element.dataset["line"]);
    const top = element.getBoundingClientRect().top - origin;
    // Nested blocks (a list in a list item) start on later lines below; anything out of order is left out.
    const last = found.at(-1);
    if (!last || (line > last.line && top > last.top)) found.push({ line, top });
  }
  return found;
}

/** The source line at the top of the scrolled page, with a fraction for the way to the next block; null for a page without marks. */
export function previewTopLine(scroller: HTMLElement): number | null {
  const all = marks(scroller);
  const position = scroller.scrollTop;
  if (!all.length) return null;
  if (position <= 0) return 1;
  let index = all.findLastIndex((mark) => mark.top <= position);
  if (index < 0) index = 0;
  const mark = all[index]!;
  const next = all[index + 1];
  if (!next) return mark.line;
  const share = Math.min(1, Math.max(0, (position - mark.top) / (next.top - mark.top)));
  return mark.line + share * (next.line - mark.line);
}

/** Scrolls the page so that the source line is at its top. */
export function scrollPreviewToLine(scroller: HTMLElement, line: number): void {
  const all = marks(scroller);
  if (!all.length || line <= 1) return void (scroller.scrollTop = 0);
  const index = all.findLastIndex((mark) => mark.line <= line);
  if (index < 0) return void (scroller.scrollTop = 0);
  const mark = all[index]!;
  const next = all[index + 1];
  const share = next ? (line - mark.line) / (next.line - mark.line) : 0;
  scroller.scrollTop = mark.top + share * ((next?.top ?? mark.top) - mark.top);
}
