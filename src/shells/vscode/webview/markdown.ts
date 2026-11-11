/**
 * Rendered Markdown in a webview, with the app's own pipeline: Genbeya's
 * wiki syntax, highlighted code, diagrams, math, embeds and repository
 * images. Links and checkboxes are reported to the extension, which follows them.
 */
import type mermaid from "mermaid";
import type katex from "katex";
import type { Rockuml } from "@rockuml/core";
import { checkPinned, fillEmbed, type EmbeddedFiles } from "../../../client/app/markdown/file-embeds";
import { footnotePreview } from "../../../client/app/markdown/footnotes";
import { resolveHref } from "../../../client/app/markdown/link-target";
import { icon, renderMarkdownTree, type Diagram, type Formula, type RepositoryImage } from "../../../client/app/markdown/markdown-dom";
import { parseMarkdown, type GenbeyaOptions } from "../../../client/app/markdown/markdown-pipeline";
import { mathElement } from "../../../client/app/markdown/mathml";
import { today } from "../../../client/app/ui/calendar-date";
import { flattenPages, subpagesOf, findPage } from "../../../client/app/features/wiki/wiki-pages";
import type { ContentArea } from "../../../contracts/model";
import type { Bridge } from "./bridge";
import type { MarkdownContext } from "./protocol";

/** Where rendered Markdown comes from: the file, its area, and whether its checkboxes toggle (a task's description, not its comments). */
export interface Source {
  readonly path: string;
  readonly area: ContentArea;
  readonly checkboxes: boolean;
}

interface Render {
  readonly objectUrls: string[];
}

const light = () => document.body.classList.contains("vscode-light") || document.body.classList.contains("vscode-high-contrast-light");

let mermaidModule: Promise<typeof mermaid> | null = null;
let katexModule: Promise<typeof katex> | null = null;
let rockumlEngine: Promise<Rockuml> | null = null;
let diagramCounter = 0;

/** Reference targets, mentions and subpages of a document, from what the extension sent. */
export function markdownOptions(context: MarkdownContext, path: string): GenbeyaOptions {
  return {
    references: {
      wikiRoot: context.wikiRoot,
      pages: flattenPages(context.wiki).map(({ title, path }) => ({ title, path })),
      tasks: context.tasks,
      statuses: context.statuses,
      files: context.files,
    },
    people: context.people,
    subpages: subpagesOf(findPage(context.wiki, path)?.node.children ?? []),
    plan: { tasks: context.plan, statuses: context.statuses, today: today() },
  };
}

export class MarkdownRenderer {
  /** The latest render of each host, so a slow image or diagram never lands in a newer one. */
  private readonly renders = new WeakMap<HTMLElement, Render>();

  /** Embeds and pinned references read files through the extension. */
  private readonly files: EmbeddedFiles = {
    file: (path) => this.bridge.request({ type: "file", path }),
    fileAt: (path, revision) => this.bridge.request({ type: "fileAt", path, revision }),
  };

  constructor(private readonly bridge: Bridge) {}

  /** Renders `markdown` into `host`, replacing what it held. */
  render(host: HTMLElement, markdown: string, source: Source, context: MarkdownContext): void {
    for (const url of this.renders.get(host)?.objectUrls ?? []) URL.revokeObjectURL(url);
    const render: Render = { objectUrls: [] };
    this.renders.set(host, render);
    const tree = parseMarkdown(markdown, markdownOptions(context, source.path));
    const rendered = renderMarkdownTree(tree, document, { path: source.path, interactiveCheckboxes: source.checkboxes });
    host.classList.add("markdown", "selectable");
    host.replaceChildren(rendered.fragment);
    host.dataset["path"] = source.path;
    host.dataset["area"] = source.area;
    const current = () => this.renders.get(host) === render;
    for (const image of rendered.images) void this.load(image, current);
    for (const diagram of rendered.diagrams) void this.draw(diagram, current, render);
    for (const formula of rendered.formulas) void this.typeset(formula, current);
    for (const embed of rendered.embeds) void fillEmbed(embed, this.files, current);
    for (const link of host.querySelectorAll<HTMLAnchorElement>("a.md-ref-pinned"))
      void checkPinned(link, source.path, this.files, current);
  }

  /** Follows links and toggles checkboxes in rendered Markdown below `root`. */
  listen(root: HTMLElement): void {
    root.addEventListener("click", (event) => {
      const target = event.target as Element;
      const host = target.closest<HTMLElement>(".markdown[data-path]");
      if (!host) return;
      const copy = target.closest<HTMLElement>("[data-copy]");
      if (copy) return void navigator.clipboard.writeText(copy.dataset["copy"] ?? "");
      const wrap = target.closest<HTMLElement>("[data-wrap]");
      if (wrap) {
        const wrapped = wrap.closest(".md-code")?.classList.toggle("is-wrapped") ?? false;
        return wrap.setAttribute("aria-pressed", String(wrapped));
      }
      const checkbox = target.closest<HTMLElement>(".md-check.is-interactive");
      if (checkbox) return this.toggle(host, Number(checkbox.dataset["offset"]));
      const anchor = target.closest("a");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href");
      if (!href) return;
      const link = resolveHref(host.dataset["path"]!, href);
      if (link.kind === "anchor") host.querySelector(`#${CSS.escape(link.id)}`)?.scrollIntoView({ behavior: "smooth" });
      else if (link.kind !== "person") this.bridge.post({ type: "follow", link });
    });
    root.addEventListener("keydown", (event) => {
      const checkbox = (event.target as Element).closest<HTMLElement>(".md-check.is-interactive");
      const host = checkbox?.closest<HTMLElement>(".markdown[data-path]");
      if (!checkbox || !host || (event.key !== " " && event.key !== "Enter")) return;
      event.preventDefault();
      this.toggle(host, Number(checkbox.dataset["offset"]));
    });
    let preview: HTMLElement | null = null;
    root.addEventListener("mouseover", (event) => {
      const reference = (event.target as Element).closest<HTMLAnchorElement>("a[data-footnote-ref]");
      const host = reference?.closest<HTMLElement>(".markdown");
      if (!reference || !host) return;
      preview?.remove();
      preview = footnotePreview(reference, host);
    });
    root.addEventListener("mouseout", (event) => {
      if ((event.target as Element).closest("a[data-footnote-ref]")) preview = (preview?.remove(), null);
    });
  }

  private toggle(host: HTMLElement, offset: number) {
    this.bridge.post({ type: "toggle", area: host.dataset["area"] as ContentArea, path: host.dataset["path"]!, offset });
  }

  private async load(image: RepositoryImage, current: () => boolean) {
    try {
      const url = await this.bridge.request({ type: "image", path: image.path });
      if (current()) image.element.src = url;
    } catch {
      if (!current()) return;
      const placeholder = document.createElement("span");
      placeholder.className = "md-remote-image";
      placeholder.append(icon(document, "imageOff", 14), document.createTextNode(` ${image.element.alt || image.path}`));
      image.element.replaceWith(placeholder);
    }
  }

  /** Diagrams are shown as images, so markup inside them can never run. */
  private async draw({ element, language, source }: Diagram, current: () => boolean, render: Render) {
    const name = language === "mermaid" ? "Mermaid" : "PlantUML";
    try {
      const { svg, isError } = language === "mermaid" ? await drawMermaid(source) : await drawPlantUml(source);
      if (!current()) return;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      render.objectUrls.push(url);
      const image = document.createElement("img");
      image.src = url;
      image.alt = `${name} diagram`;
      element.classList.toggle("is-error", isError);
      element.replaceChildren(image);
    } catch (error) {
      if (!current()) return;
      const failure = document.createElement("div");
      failure.className = "md-diagram-error";
      const title = document.createElement("strong");
      title.textContent = `${name} diagram`;
      const message = document.createElement("span");
      message.textContent = error instanceof Error ? error.message : String(error);
      const code = document.createElement("pre");
      code.textContent = source;
      failure.append(title, message, code);
      element.replaceWith(failure);
    }
  }

  /** LaTeX as MathML through the app's allowlist, never as HTML. */
  private async typeset({ element, source, display }: Formula, current: () => boolean) {
    let math: Element | null = null;
    let error = "";
    try {
      const tex = await (katexModule ??= import("katex").then((module) => module.default));
      const markup = tex.renderToString(source, {
        output: "mathml",
        throwOnError: true,
        trust: false,
        strict: "warn",
        maxSize: 20,
        maxExpand: 500,
        displayMode: display,
      });
      math = mathElement(markup, document);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
    if (!current()) return;
    if (math) return element.replaceWith(math);
    element.classList.add("md-math-error");
    element.title = error || "KaTeX returned no formula.";
  }
}

async function drawMermaid(source: string) {
  const engine = await (mermaidModule ??= import("mermaid").then((module) => module.default));
  engine.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: light() ? "neutral" : "dark",
    fontFamily: getComputedStyle(document.body).fontFamily,
    // Labels as SVG text, so the diagram works as an image.
    flowchart: { htmlLabels: false },
  });
  const { svg } = await engine.render(`gd-mermaid-${++diagramCounter}`, source);
  // As an image, width="100%" would stretch the diagram; keep its natural width instead.
  const width = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /.exec(svg)?.[1];
  return { svg: width ? svg.replace('width="100%"', `width="${width}"`) : svg, isError: false };
}

async function drawPlantUml(source: string) {
  const engine = await (rockumlEngine ??= import("@rockuml/core").then(({ load }) => load(document.body.dataset["rockuml"])));
  // A bare diagram body is a convenience; rockuml needs the start and end markers.
  const text = /^\s*@start/m.test(source) ? source : `@startuml\n${source}\n@enduml`;
  const { data, isError } = await engine.render(text);
  return { svg: data, isError };
}
