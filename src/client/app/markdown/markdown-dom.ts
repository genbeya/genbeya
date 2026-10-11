/**
 * Builds DOM from the Markdown syntax tree. Only allowlisted elements,
 * attributes and URL schemes are created; nothing is parsed as HTML, so
 * page content cannot inject markup or scripts.
 */
import type { Element, ElementContent, Root, RootContent } from "hast";
import { toText } from "hast-util-to-text";
import { MISSING_PAGE, PERSON_LINK, resolveHref, type LinkTarget } from "./link-target";

const ALLOWED = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "blockquote",
  "pre",
  "code",
  "em",
  "strong",
  "del",
  "a",
  "img",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "hr",
  "br",
  "span",
  "div",
  "sup",
  "sub",
  "section",
  "kbd",
  "details",
  "summary",
]);
/** Dropped together with their content. */
const BLOCKED = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "textarea",
  "button",
  "select",
  "link",
  "meta",
  "base",
  "svg",
  "math",
  "template",
  "noscript",
]);
const ATTRIBUTES: Readonly<Record<string, string>> = {
  id: "id",
  title: "title",
  alt: "alt",
  colSpan: "colspan",
  rowSpan: "rowspan",
  align: "align",
  start: "start",
  ariaDescribedBy: "aria-describedby",
  ariaLabel: "aria-label",
  open: "open",
};
/** Data attributes of callouts, footnotes, embeds and code lines; plugins name them `dataX` or `data-x`. */
const DATA_ATTRIBUTES = new Set([
  "data-callout",
  "data-footnote-ref",
  "data-footnote-backref",
  "data-footnotes",
  "data-embed",
  "data-lines",
  "data-line",
]);

function attributeName(property: string): string | undefined {
  const dashed = property.startsWith("data") ? property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`) : property;
  return ATTRIBUTES[property] ?? (DATA_ATTRIBUTES.has(dashed) ? dashed : undefined);
}
const SAFE_CLASS = /^[A-Za-z0-9_-]+$/;
const SAFE_URL = /^(https?:|mailto:|#|\/|\.{0,2}[^:]*$)/i;
const DIAGRAM_LANGUAGES: Readonly<Record<string, Diagram["language"]>> = { mermaid: "mermaid", plantuml: "plantuml", puml: "plantuml" };

export interface Diagram {
  readonly element: HTMLElement;
  readonly language: "mermaid" | "plantuml";
  readonly source: string;
}

/** A LaTeX formula to typeset into `element` once inserted. */
export interface Formula {
  readonly element: HTMLElement;
  readonly source: string;
  /** A block (`$$`, ```math) rather than inline. */
  readonly display: boolean;
}

export interface RepositoryImage {
  readonly element: HTMLImageElement;
  readonly path: string;
}

/** Lines of a repository file shown in place (`![[path#L1-L9]]`). */
export interface Embed {
  readonly element: HTMLElement;
  readonly path: string;
  /** "10-20", or null for the whole file. */
  readonly lines: string | null;
}

export interface RenderedMarkdown {
  readonly fragment: DocumentFragment;
  /** Placeholders to fill with file contents once inserted. */
  readonly embeds: readonly Embed[];
  /** Placeholders to draw diagrams into once inserted. */
  readonly diagrams: readonly Diagram[];
  /** Placeholders to typeset formulas into once inserted. */
  readonly formulas: readonly Formula[];
  /** Images from the repository, to load through the managers. */
  readonly images: readonly RepositoryImage[];
}

export interface RenderOptions {
  /** Repository path of the document, for relative links and images. */
  readonly path: string;
  /** Makes task-list checkboxes clickable; they carry their source offset. */
  readonly interactiveCheckboxes: boolean;
}

const SVG = "http://www.w3.org/2000/svg";
/** Lucide icon shapes used inside rendered Markdown. */
const ICONS: Readonly<Record<string, readonly string[]>> = {
  check: ["M20 6 9 17l-5-5"],
  fileText: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M10 9H8", "M16 13H8", "M16 17H8"],
  fileCode: [
    "M10 12.5 8 15l2 2.5",
    "m14 12.5 2 2.5-2 2.5",
    "M14 2v4a2 2 0 0 0 2 2h4",
    "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z",
  ],
  copy: [
    "M8 10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z",
    "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
  ],
  wrap: ["m16 16-3 3 3 3", "M3 12h14.5a1 1 0 0 1 0 7H13", "M3 19h6", "M3 5h18"],
  imageOff: [
    "m2 2 20 20",
    "M10.41 10.41a2 2 0 1 1-2.83-2.83",
    "m13.5 13.5-7.5 7.5",
    "m18 12 3 3",
    "M3.59 3.59A1.99 1.99 0 0 0 3 5v14a2 2 0 0 0 2 2h14c.55 0 1.052-.22 1.41-.59",
    "M21 15V5a2 2 0 0 0-2-2H9",
  ],
};

export function icon(document: Document, name: keyof typeof ICONS, size: number, strokeWidth = 2): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  for (const [key, value] of Object.entries({
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": strokeWidth,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  }))
    svg.setAttribute(key, String(value));
  for (const d of ICONS[name]!) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

const classesOf = (element: Element): string[] =>
  ((element.properties["className"] as string[] | undefined) ?? []).map(String).filter((name) => SAFE_CLASS.test(name));

export function renderMarkdownTree(tree: Root, document: Document, options: RenderOptions): RenderedMarkdown {
  const diagrams: Diagram[] = [];
  const formulas: Formula[] = [];
  const images: RepositoryImage[] = [];
  const embeds: Embed[] = [];

  const create = (tag: string, classes: string[] = []) => {
    const element = document.createElement(tag);
    if (classes.length) element.className = classes.join(" ");
    return element;
  };

  const children = (nodes: readonly (RootContent | ElementContent)[], parent: Node, taskOffset: number | null) => {
    for (const node of nodes) {
      if (node.type === "text") parent.appendChild(document.createTextNode(node.value));
      else if (node.type === "element") {
        const built = element(node, taskOffset);
        if (built) parent.appendChild(built);
      }
    }
  };

  const copyAttributes = (from: Element, to: HTMLElement) => {
    for (const [property, value] of Object.entries(from.properties)) {
      const attribute = attributeName(property);
      if (attribute && value !== null && value !== undefined && value !== false)
        to.setAttribute(attribute, value === true ? "" : String(value));
    }
    const classes = classesOf(from);
    if (classes.length) to.className = classes.join(" ");
  };

  const codeBlock = (pre: Element): Node => {
    const code = pre.children.find((child): child is Element => child.type === "element" && child.tagName === "code");
    const language = (code ? classesOf(code) : []).find((name) => name.startsWith("language-"))?.slice(9) ?? "";
    const source = code ? toText(code, { whitespace: "pre" }).replace(/\n$/, "") : "";
    const diagram = DIAGRAM_LANGUAGES[language];
    if (diagram) {
      const placeholder = create("div", ["md-diagram"]);
      placeholder.append(create("span", ["spinner"]));
      diagrams.push({ element: placeholder, language: diagram, source });
      return placeholder;
    }
    const title = code?.properties["dataTitle"];
    const block = create("div", ["md-code", ...(code?.properties["dataNumbered"] ? ["has-line-numbers"] : [])]);
    const bar = create("div", ["md-code-bar"]);
    const label = create("span", ["md-code-label"]);
    if (typeof title === "string") {
      const name = create("span", ["md-code-title"]);
      name.append(icon(document, "fileCode", 13), document.createTextNode(title));
      label.append(name);
    }
    if (language) {
      const name = create("span", ["md-code-language"]);
      name.textContent = language;
      label.append(name);
    }
    const wrap = button("Wrap lines", "wrap");
    wrap.dataset["wrap"] = "";
    wrap.setAttribute("aria-pressed", "false");
    const copy = button("Copy code", "copy");
    copy.dataset["copy"] = source;
    const actions = create("span", ["md-code-actions"]);
    actions.append(wrap, copy);
    bar.append(label, actions);
    const body = create("pre");
    children(pre.children, body, null);
    block.append(bar, body);
    return block;
  };

  const button = (label: string, image: keyof typeof ICONS) => {
    const element = create("button");
    element.setAttribute("type", "button");
    element.setAttribute("aria-label", label);
    element.title = label;
    element.append(icon(document, image, 13));
    return element;
  };

  /** The source stays readable until the formula is typeset. */
  const formula = (node: Element): Node => {
    const source = toText(node, { whitespace: "pre" });
    const display = classesOf(node).includes("is-display");
    const body = create("span", ["md-math-source"]);
    body.textContent = source;
    formulas.push({ element: body, source, display });
    if (!display) {
      const inline = create("span", ["md-math"]);
      inline.append(body);
      return inline;
    }
    const block = create("div", ["md-math", "is-display"]);
    const copy = button("Copy LaTeX", "copy");
    copy.dataset["copy"] = source;
    block.append(body, copy);
    return block;
  };

  const link = (node: Element, taskOffset: number | null): Node => {
    const href = String(node.properties["href"] ?? "");
    const anchor = create("a");
    copyAttributes(node, anchor);
    if (href.startsWith(MISSING_PAGE)) {
      anchor.className = "md-missing";
      anchor.title = "Create this page";
      anchor.setAttribute("href", href);
    } else if (href.startsWith(PERSON_LINK) || SAFE_URL.test(href)) {
      anchor.setAttribute("href", href);
      if (/^https?:/i.test(href)) anchor.title = href;
    }
    // Page and file references carry an icon; task references a coloured dot.
    const classes = classesOf(node);
    if (classes.includes("md-ref-page")) anchor.append(icon(document, "fileText", 13));
    else if (classes.includes("md-ref-file")) anchor.append(icon(document, "fileCode", 13));
    children(node.children, anchor, taskOffset);
    return anchor;
  };

  const image = (node: Element): Node => {
    const source = String(node.properties["src"] ?? "");
    const alt = String(node.properties["alt"] ?? "");
    const target: LinkTarget = resolveHref(options.path, source);
    if (target.kind !== "file") {
      // Remote images never load on their own; the link opens them in the browser.
      const remote = create("a", ["md-remote-image"]);
      if (target.kind === "external" && /^https?:/i.test(target.url)) remote.setAttribute("href", target.url);
      remote.append(icon(document, "imageOff", 14), document.createTextNode(` ${alt || "Remote image"}`));
      return remote;
    }
    const img = create("img") as HTMLImageElement;
    img.alt = alt;
    images.push({ element: img, path: target.path });
    return img;
  };

  const embed = (node: Element): Node => {
    const placeholder = create("div", ["md-embed"]);
    placeholder.append(create("span", ["spinner"]));
    const lines = node.properties["dataLines"];
    embeds.push({ element: placeholder, path: String(node.properties["dataEmbed"] ?? ""), lines: lines ? String(lines) : null });
    return placeholder;
  };

  const checkbox = (node: Element, taskOffset: number | null): Node => {
    const checked = node.properties["checked"] === true;
    const interactive = options.interactiveCheckboxes && taskOffset !== null;
    const box = create("span", ["md-check", ...(checked ? ["is-checked"] : []), ...(interactive ? ["is-interactive"] : [])]);
    box.setAttribute("role", "checkbox");
    box.setAttribute("aria-checked", String(checked));
    box.tabIndex = interactive ? 0 : -1;
    if (interactive) box.dataset["offset"] = String(taskOffset);
    if (checked) box.append(icon(document, "check", 11, 3));
    return box;
  };

  const element = (node: Element, taskOffset: number | null): Node | null => {
    const tag = node.tagName.toLowerCase();
    if (BLOCKED.has(tag)) return null;
    if (tag === "input") return node.properties["type"] === "checkbox" ? checkbox(node, taskOffset) : null;
    if (tag === "pre") return codeBlock(node);
    if (tag === "a") return link(node, taskOffset);
    if (tag === "img") return image(node);
    if (tag === "div" && classesOf(node).includes("md-embed")) return embed(node);
    if ((tag === "span" || tag === "div") && classesOf(node).includes("md-math")) return formula(node);
    if (!ALLOWED.has(tag)) {
      const unwrapped = document.createDocumentFragment();
      children(node.children, unwrapped, taskOffset);
      return unwrapped;
    }
    const built = create(tag);
    copyAttributes(node, built);
    const offset = tag === "li" && classesOf(node).includes("task-list-item") ? (node.position?.start.offset ?? null) : taskOffset;
    children(node.children, built, offset);
    if (tag === "table") {
      const wrapper = create("div", ["md-table"]);
      wrapper.append(built);
      return wrapper;
    }
    return built;
  };

  const fragment = document.createDocumentFragment();
  children(tree.children, fragment, null);
  return { fragment, embeds, diagrams, formulas, images };
}
