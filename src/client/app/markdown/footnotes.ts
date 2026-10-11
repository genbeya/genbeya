/** Footnotes (`[^1]`, GitHub's syntax): a preview of the note at its reference. */

const GAP = 6;
const MARGIN = 8;

/**
 * A card with the text of the note `reference` points to, placed below it
 * (above when there is no room) and added to `host`; null when the note is
 * not in `host`. The card is a copy of already rendered nodes.
 */
export function footnotePreview(reference: HTMLAnchorElement, host: HTMLElement): HTMLElement | null {
  const id = reference.getAttribute("href")?.replace(/^#/, "");
  const note = id ? host.querySelector(`#${CSS.escape(id)}`) : null;
  if (!note) return null;
  const card = host.ownerDocument.createElement("div");
  card.className = "md-footnote-preview";
  card.setAttribute("role", "tooltip");
  for (const child of Array.from(note.childNodes)) card.append(child.cloneNode(true));
  for (const back of Array.from(card.querySelectorAll("[data-footnote-backref]"))) back.remove();
  for (const named of Array.from(card.querySelectorAll("[id]"))) named.removeAttribute("id");
  host.append(card);
  const view = host.ownerDocument.defaultView!;
  const anchor = reference.getBoundingClientRect();
  const size = card.getBoundingClientRect();
  const below = anchor.bottom + GAP + size.height <= view.innerHeight - MARGIN;
  card.style.left = `${Math.max(MARGIN, Math.min(anchor.left, view.innerWidth - size.width - MARGIN))}px`;
  card.style.top = `${below ? anchor.bottom + GAP : Math.max(MARGIN, anchor.top - GAP - size.height)}px`;
  return card;
}
