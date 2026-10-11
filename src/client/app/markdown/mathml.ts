/**
 * MathML from KaTeX, rebuilt through an allowlist like the rest of a page:
 * the markup is parsed into an inert document, and only MathML Core
 * elements with presentational attributes are created anew. No styles, no
 * links, no HTML; text stays text.
 */
import { styledText } from "./math-alphabets";

export const MATHML = "http://www.w3.org/1998/Math/MathML";

const ELEMENTS = new Set([
  "math",
  "semantics",
  "annotation",
  "mrow",
  "mi",
  "mn",
  "mo",
  "ms",
  "mtext",
  "mspace",
  "msub",
  "msup",
  "msubsup",
  "munder",
  "mover",
  "munderover",
  "mmultiscripts",
  "mprescripts",
  "none",
  "mfrac",
  "msqrt",
  "mroot",
  "mstyle",
  "merror",
  "mpadded",
  "mphantom",
  "mtable",
  "mtr",
  "mtd",
  "menclose",
]);
const ATTRIBUTES = new Set([
  "display",
  "displaystyle",
  "scriptlevel",
  "mathcolor",
  "mathbackground",
  "mathsize",
  "mathvariant",
  "fence",
  "separator",
  "stretchy",
  "symmetric",
  "largeop",
  "movablelimits",
  "accent",
  "accentunder",
  "lspace",
  "rspace",
  "minsize",
  "maxsize",
  "form",
  "linethickness",
  "width",
  "height",
  "depth",
  "voffset",
  "columnalign",
  "rowalign",
  "columnspacing",
  "rowspacing",
  "columnlines",
  "rowlines",
  "frame",
  "framespacing",
  "notation",
  "columnspan",
  "rowspan",
  "encoding",
]);
/** Lengths, keywords and colours; never `url(…)`, quotes, colons or markup. */
const SAFE_VALUE = /^[\w\s.#%,+-]*$/;
const COLOURS = new Set(["mathcolor", "mathbackground"]);
/** Elements whose letters take `mathvariant` (as characters, see math-alphabets.ts). */
const TOKENS = new Set(["mi", "mn", "mo", "ms"]);

/** A KaTeX MathML string as a `<math>` element of `document`; null when it holds none. */
export function mathElement(markup: string, document: Document): Element | null {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  const source = parsed.getElementsByTagNameNS(MATHML, "math")[0];
  return source ? (rebuild(source, document, null) as Element | null) : null;
}

function rebuild(node: Node, document: Document, variant: string | null): Node | null {
  if (node.nodeType === node.TEXT_NODE) {
    const text = node.textContent ?? "";
    return document.createTextNode((variant && styledText(text, variant)) ?? text);
  }
  if (node.nodeType !== node.ELEMENT_NODE) return null;
  const source = node as Element;
  if (source.namespaceURI !== MATHML || !ELEMENTS.has(source.localName)) return null;
  const element = document.createElementNS(MATHML, source.localName);
  let inner: string | null = null;
  for (const { name, value } of Array.from(source.attributes)) {
    if (!ATTRIBUTES.has(name)) continue;
    if (name === "encoding") {
      // The LaTeX source, for screen readers and copying.
      if (value === "application/x-tex") element.setAttribute(name, value);
      continue;
    }
    if (!SAFE_VALUE.test(value)) continue;
    // Variants other than `normal` become characters on tokens; `mtext` keeps them for the styles.
    if (name === "mathvariant" && TOKENS.has(source.localName) && styledText("", value) !== null) {
      inner = value;
      continue;
    }
    // Black is written for white paper; in the dark theme it follows the text instead.
    element.setAttribute(name, COLOURS.has(name) && value.toLowerCase() === "black" ? "currentcolor" : value);
  }
  for (const child of Array.from(source.childNodes)) {
    const built = rebuild(child, document, inner ?? variant);
    if (built) element.append(built);
  }
  return element;
}
