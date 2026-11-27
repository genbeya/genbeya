/**
 * Rendered Markdown outside the app, with the app's own pipeline: Genbeya's
 * wiki syntax, highlighted code, diagrams, math, embeds, repository images
 * and plans. One renderer for every host that shows it in a web view: the VS
 * Code webviews and the kit. It reads nothing itself; files, images and the
 * plan's history come from the host, and links and checkboxes go to it.
 */
import type mermaid from "mermaid";
import type katex from "katex";
import type { Rockuml } from "@rockuml/core";
import { checkPinned, fillEmbed, type EmbeddedFiles } from "../../client/app/markdown/file-embeds";
import { footnotePreview } from "../../client/app/markdown/footnotes";
import { resolveHref, type LinkTarget } from "../../client/app/markdown/link-target";
import {
  icon,
  renderMarkdownTree,
  type Diagram,
  type Formula,
  type PlanHistoryBlock,
  type RepositoryImage,
} from "../../client/app/markdown/markdown-dom";
import { parseMarkdown, type GenbeyaOptions } from "../../client/app/markdown/markdown-pipeline";
import { mathElement } from "../../client/app/markdown/mathml";
import { planHistoryMarkdown } from "../../client/app/markdown/plan-history-markdown";
import { today } from "../../client/app/ui/calendar-date";
import { flattenPages, subpagesOf, findPage } from "../../client/app/features/wiki/wiki-pages";
import type { ContentArea, Person, PlanHistory, Task, WikiNode } from "../../contracts/model";
import type { PlanCalendar, PlanTask } from "../../utilities/planning";

/** What rendered Markdown refers to: pages, tasks, files and people, and the plan. */
export interface RenderContext {
  readonly wikiRoot: string;
  readonly wiki: readonly WikiNode[];
  readonly tasks: readonly Pick<Task, "id" | "path" | "title" | "status">[];
  /** The tasks as plans show them; none while the project doesn't use planning. */
  readonly plan: readonly PlanTask[];
  readonly statuses: readonly string[];
  /** Working days, days off and milestones; weekdays only, and no milestones, without. */
  readonly calendar?: PlanCalendar;
  readonly files: readonly string[];
  readonly people: readonly Person[];
}

/** Where rendered Markdown comes from: the file, its area, the version shown, and whether its checkboxes toggle. */
export interface Source {
  readonly path: string;
  readonly area: ContentArea;
  readonly checkboxes: boolean;
  /** The version of the file shown; a toggle names it, so it never lands in a newer one. */
  readonly hash?: string;
}

/** A link the user followed, resolved against its document; anchors scroll in place. */
export type FollowedLink = Exclude<LinkTarget, { kind: "anchor" }>;

/** What the renderer asks its host for; each resolves to text: a data URL, a file's content, a plan's history as JSON. */
export type HostRequest =
  | { readonly type: "image"; readonly path: string }
  | { readonly type: "file"; readonly path: string }
  | { readonly type: "fileAt"; readonly path: string; readonly revision: string }
  | { readonly type: "planHistory"; readonly baseline: string | null };

/** The web view's host: the VS Code extension, or whatever shows the kit. */
export interface RendererHost {
  request(request: HostRequest): Promise<string>;
  follow(link: FollowedLink): void;
  /** The checkbox at `offset` of `source`'s text was clicked. */
  toggle(source: Source, offset: number): void;
  /** Whether the page is light, for the diagrams' colours. */
  light(): boolean;
  /** Where rockuml's WebAssembly is served, relative to the page. */
  readonly rockumlWasm?: string;
}

interface Render {
  readonly objectUrls: string[];
  readonly source: Source;
  readonly context: RenderContext;
}

let mermaidModule: Promise<typeof mermaid> | null = null;
let katexModule: Promise<typeof katex> | null = null;
let rockumlEngine: Promise<Rockuml> | null = null;
let diagramCounter = 0;

/** Reference targets, mentions, subpages and the plan of a document, from what the host sent. */
export function markdownOptions(context: RenderContext, path: string): GenbeyaOptions {
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
    plan: {
      tasks: context.plan,
      statuses: context.statuses,
      today: today(),
      ...(context.calendar ? { calendar: context.calendar } : {}),
    },
  };
}

export class MarkdownRenderer {
  /** The latest render of each host element, so a slow image or diagram never lands in a newer one. */
  private readonly renders = new WeakMap<HTMLElement, Render>();

  /** Embeds and pinned references read files through the host. */
  private readonly files: EmbeddedFiles = {
    file: (path) => this.host.request({ type: "file", path }),
    fileAt: (path, revision) => this.host.request({ type: "fileAt", path, revision }),
  };

  constructor(private readonly host: RendererHost) {}

  /** Renders `markdown` into `element`, replacing what it held. */
  render(element: HTMLElement, markdown: string, source: Source, context: RenderContext): void {
    for (const url of this.renders.get(element)?.objectUrls ?? []) URL.revokeObjectURL(url);
    const render: Render = { objectUrls: [], source, context };
    this.renders.set(element, render);
    const tree = parseMarkdown(markdown, markdownOptions(context, source.path));
    const rendered = renderMarkdownTree(tree, document, { path: source.path, interactiveCheckboxes: source.checkboxes });
    element.classList.add("markdown", "selectable");
    element.replaceChildren(rendered.fragment);
    element.dataset["path"] = source.path;
    element.dataset["area"] = source.area;
    const current = () => this.renders.get(element) === render;
    for (const image of rendered.images) void this.load(image, current);
    for (const diagram of rendered.diagrams) void this.draw(diagram, current, render);
    for (const formula of rendered.formulas) void this.typeset(formula, current);
    for (const embed of rendered.embeds) void fillEmbed(embed, this.files, current);
    for (const history of rendered.histories) void this.fillHistory(history, current, render);
    for (const link of element.querySelectorAll<HTMLAnchorElement>("a.md-ref-pinned"))
      void checkPinned(link, source.path, this.files, current);
  }

  /** Follows links and toggles checkboxes in rendered Markdown below `root`. */
  listen(root: HTMLElement): void {
    root.addEventListener("click", (event) => {
      const target = event.target as Element;
      const element = target.closest<HTMLElement>(".markdown[data-path]");
      if (!element) return;
      const copy = target.closest<HTMLElement>("[data-copy]");
      if (copy) return void navigator.clipboard.writeText(copy.dataset["copy"] ?? "");
      const wrap = target.closest<HTMLElement>("[data-wrap]");
      if (wrap) {
        const wrapped = wrap.closest(".md-code")?.classList.toggle("is-wrapped") ?? false;
        return wrap.setAttribute("aria-pressed", String(wrapped));
      }
      const checkbox = target.closest<HTMLElement>(".md-check.is-interactive");
      if (checkbox) return this.toggle(element, Number(checkbox.dataset["offset"]));
      const anchor = target.closest("a");
      if (!anchor) return;
      event.preventDefault();
      const href = anchor.getAttribute("href");
      if (!href) return;
      const link = resolveHref(element.dataset["path"]!, href);
      if (link.kind === "anchor") element.querySelector(`#${CSS.escape(link.id)}`)?.scrollIntoView({ behavior: "smooth" });
      else this.host.follow(link);
    });
    root.addEventListener("keydown", (event) => {
      const checkbox = (event.target as Element).closest<HTMLElement>(".md-check.is-interactive");
      const element = checkbox?.closest<HTMLElement>(".markdown[data-path]");
      if (!checkbox || !element || (event.key !== " " && event.key !== "Enter")) return;
      event.preventDefault();
      this.toggle(element, Number(checkbox.dataset["offset"]));
    });
    let preview: HTMLElement | null = null;
    root.addEventListener("mouseover", (event) => {
      const reference = (event.target as Element).closest<HTMLAnchorElement>("a[data-footnote-ref]");
      const element = reference?.closest<HTMLElement>(".markdown");
      if (!reference || !element) return;
      preview?.remove();
      preview = footnotePreview(reference, element);
    });
    root.addEventListener("mouseout", (event) => {
      if ((event.target as Element).closest("a[data-footnote-ref]")) preview = (preview?.remove(), null);
    });
  }

  private toggle(element: HTMLElement, offset: number) {
    const render = this.renders.get(element);
    if (render) this.host.toggle(render.source, offset);
  }

  private async load(image: RepositoryImage, current: () => boolean) {
    try {
      const url = await this.host.request({ type: "image", path: image.path });
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
      const { svg, isError } = language === "mermaid" ? await this.drawMermaid(source) : await this.drawPlantUml(source);
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

  /** `[BURNDOWN]` and `[BASELINE]`: drawn once the host answers with the plan's history. */
  private async fillHistory({ element, kind, args }: PlanHistoryBlock, current: () => boolean, render: Render) {
    const options = markdownOptions(render.context, render.source.path);
    let markdown: string;
    try {
      const load = async (baseline: string | null) => JSON.parse(await this.host.request({ type: "planHistory", baseline })) as PlanHistory;
      markdown = render.context.plan.length ? await planHistoryMarkdown(kind, args, options.plan!, load) : "*No tasks to plan here.*";
    } catch (error) {
      markdown = `*Can't read the plan's history: ${error instanceof Error ? error.message : String(error)}*`;
    }
    if (!current()) return;
    const rendered = renderMarkdownTree(parseMarkdown(markdown, options), document, {
      path: render.source.path,
      interactiveCheckboxes: false,
    });
    element.replaceChildren(rendered.fragment);
    for (const diagram of rendered.diagrams) void this.draw(diagram, current, render);
  }

  private async drawMermaid(source: string) {
    const engine = await (mermaidModule ??= import("mermaid").then((module) => module.default));
    engine.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: this.host.light() ? "neutral" : "dark",
      fontFamily: getComputedStyle(document.body).fontFamily,
      // Labels as SVG text, so the diagram works as an image.
      flowchart: { htmlLabels: false },
    });
    const { svg } = await engine.render(`gd-mermaid-${++diagramCounter}`, source);
    // As an image, width="100%" would stretch the diagram; keep its natural width instead.
    const width = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) /.exec(svg)?.[1];
    return { svg: width ? svg.replace('width="100%"', `width="${width}"`) : svg, isError: false };
  }

  private async drawPlantUml(source: string) {
    const engine = await (rockumlEngine ??= import("@rockuml/core").then(({ load }) => load(this.host.rockumlWasm)));
    // A bare diagram body is a convenience; rockuml needs the start and end markers.
    const text = /^\s*@start/m.test(source) ? source : `@startuml\n${source}\n@enduml`;
    const { data, isError } = await engine.render(text);
    return { svg: data, isError };
  }
}
