/**
 * Rendered Markdown: GitDesk's wiki syntax, highlighted code, diagrams, math
 * and repository images. Links and checkboxes are reported, not followed.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, untracked } from "@angular/core";
import type { Scope } from "../../../contracts/model";
import { Clipboard } from "../core/clipboard";
import { Session } from "../core/session";
import { WorkspaceApi } from "../core/workspace-api";
import { Theme } from "../core/theme";
import { Diagrams } from "./diagrams";
import { resolveHref, type LinkTarget } from "./link-target";
import { embedSource } from "./embeds";
import { footnotePreview } from "./footnotes";
import {
  icon,
  renderMarkdownTree,
  type Diagram,
  type Embed,
  type Formula,
  type RenderedMarkdown,
  type RepositoryImage,
} from "./markdown-dom";
import { parseMarkdown, type GitdeskOptions } from "./markdown-pipeline";
import { Typesetter } from "./typesetter";

const COPIED_FEEDBACK = 1200;

@Component({
  selector: "gd-markdown",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "markdown selectable",
    "(click)": "click($event)",
    "(keydown)": "key($event)",
    "(mouseover)": "hover($event)",
    "(mouseout)": "unhover($event)",
  },
  template: "",
})
export class MarkdownView {
  readonly source = input.required<string>();
  /** Repository path of the document, for relative links and images. */
  readonly path = input.required<string>();
  /** Where the document's images are read from. */
  readonly scope = input<Scope>("content");
  readonly links = input<GitdeskOptions>({});
  /** Makes task-list checkboxes clickable. */
  readonly checkboxes = input(false);
  readonly linkClicked = output<LinkTarget>();
  readonly checkboxToggled = output<number>();
  /** After every render, with the element holding the content (for outlines and anchors). */
  readonly rendered = output<HTMLElement>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly api = inject(WorkspaceApi);
  private readonly clipboard = inject(Clipboard);
  private readonly diagrams = inject(Diagrams);
  private readonly typesetter = inject(Typesetter);
  private readonly theme = inject(Theme);
  private objectUrls: string[] = [];
  /** Images by path, so re-renders (typing in the preview) do not read them again. Cleared when the repository changes. */
  private images = new Map<string, Promise<string>>();
  /** Embedded files by path, like images. */
  private files = new Map<string, Promise<string>>();
  /** Renders count up, so a slow image or diagram never lands in a newer render. */
  private generation = 0;
  /** The footnote reference under the pointer and the preview of its note. */
  private previewed: Element | null = null;
  private preview: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const tree = parseMarkdown(this.source(), this.links());
      const rendered = renderMarkdownTree(tree, document, { path: this.path(), interactiveCheckboxes: this.checkboxes() });
      // Diagrams follow the theme.
      this.theme.resolved();
      untracked(() => this.show(rendered));
    });
    const session = inject(Session);
    effect(() => {
      void session.snapshot()?.version;
      this.images = new Map();
      this.files = new Map();
    });
    inject(DestroyRef).onDestroy(() => {
      // Late images and diagrams must not land after this.
      this.generation++;
      this.revoke();
    });
  }

  private show({ fragment, images, diagrams, formulas, embeds }: RenderedMarkdown) {
    const generation = ++this.generation;
    this.revoke();
    this.preview = this.previewed = null;
    this.host.replaceChildren(fragment);
    this.rendered.emit(this.host);
    for (const image of images) void this.load(image, generation);
    for (const diagram of diagrams) void this.draw(diagram, generation);
    for (const formula of formulas) void this.typeset(formula, generation);
    for (const embed of embeds) void this.embed(embed, generation);
  }

  /** Lines of a repository file, highlighted like a code block, under a link to the file. */
  private async embed({ element, path, lines }: Embed, generation: number) {
    const title = document.createElement("a");
    title.className = "md-embed-title";
    title.append(icon(document, "fileCode", 13), document.createTextNode(path));
    let body: Node;
    try {
      const source = embedSource(path, await this.file(path), lines);
      if (generation !== this.generation) return;
      title.setAttribute("href", `/${path}#L${source.from}-L${source.to}`);
      const range = document.createElement("span");
      range.className = "md-ref-lines";
      range.textContent = source.from === source.to ? `:${source.from}` : `:${source.from}–${source.to}`;
      title.append(range);
      body = renderMarkdownTree(parseMarkdown(source.markdown), document, { path, interactiveCheckboxes: false }).fragment;
      if (source.cut) {
        const note = document.createElement("p");
        note.className = "md-embed-note";
        note.textContent = "Cut short; open the file for the rest.";
        body.appendChild(note);
      }
    } catch (error) {
      if (generation !== this.generation) return;
      title.setAttribute("href", `/${path}`);
      element.classList.add("is-error");
      body = document.createElement("p");
      body.textContent = error instanceof Error ? error.message : String(error);
    }
    element.replaceChildren(title, body);
  }

  /** Code lives in the repository, whichever branch holds the wiki. */
  private file(path: string): Promise<string> {
    const files = this.files;
    let content = files.get(path);
    if (!content) {
      content = this.api.content.read("repo", path).then((file) => file.content);
      content.catch(() => files.delete(path));
      files.set(path, content);
    }
    return content;
  }

  private async load(image: RepositoryImage, generation: number) {
    try {
      const url = await this.image(image.path);
      if (generation === this.generation) image.element.src = url;
    } catch {
      if (generation === this.generation) image.element.replaceWith(this.missingImage(image));
    }
  }

  private image(path: string): Promise<string> {
    const images = this.images;
    let url = images.get(path);
    if (!url) {
      url = this.api.content.image(untracked(this.scope), path);
      url.catch(() => images.delete(path));
      images.set(path, url);
    }
    return url;
  }

  private async draw({ element, language, source }: Diagram, generation: number) {
    try {
      const { svg, isError } = await this.diagrams.draw(language, source);
      if (generation !== this.generation) return;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      this.objectUrls.push(url);
      const image = document.createElement("img");
      image.src = url;
      image.alt = `${language === "mermaid" ? "Mermaid" : "PlantUML"} diagram`;
      element.classList.toggle("is-error", isError);
      element.replaceChildren(image);
    } catch (error) {
      if (generation !== this.generation) return;
      const failure = document.createElement("div");
      failure.className = "md-diagram-error";
      const title = document.createElement("strong");
      title.textContent = `${language === "mermaid" ? "Mermaid" : "PlantUML"} diagram`;
      const message = document.createElement("span");
      message.textContent = error instanceof Error ? error.message : String(error);
      const code = document.createElement("pre");
      code.textContent = source;
      failure.append(title, message, code);
      element.replaceWith(failure);
    }
  }

  private async typeset({ element, source, display }: Formula, generation: number) {
    const result = await this.typesetter.render(source, display);
    if (generation !== this.generation) return;
    if ("math" in result) return element.replaceWith(result.math);
    // The source stays, marked, with KaTeX's message on hover.
    element.classList.add("md-math-error");
    element.title = result.error;
  }

  private missingImage(image: RepositoryImage): HTMLElement {
    const placeholder = document.createElement("span");
    placeholder.className = "md-remote-image";
    placeholder.append(icon(document, "imageOff", 14), document.createTextNode(` ${image.element.alt || image.path}`));
    return placeholder;
  }

  private revoke() {
    for (const url of this.objectUrls) URL.revokeObjectURL(url);
    this.objectUrls = [];
  }

  protected click(event: MouseEvent) {
    const target = event.target as Element;
    const copy = target.closest<HTMLElement>("[data-copy]");
    if (copy) return void this.copy(copy);
    const wrap = target.closest<HTMLElement>("[data-wrap]");
    if (wrap) {
      const wrapped = wrap.closest(".md-code")?.classList.toggle("is-wrapped") ?? false;
      return wrap.setAttribute("aria-pressed", String(wrapped));
    }
    const checkbox = target.closest<HTMLElement>(".md-check.is-interactive");
    if (checkbox) return this.checkboxToggled.emit(Number(checkbox.dataset["offset"]));
    const anchor = target.closest("a");
    if (!anchor || !this.host.contains(anchor)) return;
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href) return;
    const link = resolveHref(this.path(), href);
    if (link.kind === "anchor") this.host.querySelector(`#${CSS.escape(link.id)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    else this.linkClicked.emit(link);
  }

  protected key(event: KeyboardEvent) {
    const checkbox = (event.target as Element).closest<HTMLElement>(".md-check.is-interactive");
    if (checkbox && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      this.checkboxToggled.emit(Number(checkbox.dataset["offset"]));
    }
  }

  /** Footnote references show their note while the pointer is on them. */
  protected hover(event: MouseEvent) {
    const reference = (event.target as Element).closest<HTMLAnchorElement>("a[data-footnote-ref]");
    if (!reference || this.previewed === reference) return;
    this.preview?.remove();
    this.previewed = reference;
    this.preview = footnotePreview(reference, this.host);
  }

  protected unhover(event: MouseEvent) {
    const reference = (event.target as Element).closest("a[data-footnote-ref]");
    if (!reference || reference.contains(event.relatedTarget as Node | null)) return;
    this.preview?.remove();
    this.preview = this.previewed = null;
  }

  private async copy(button: HTMLElement) {
    if (!(await this.clipboard.copy(button.dataset["copy"] ?? ""))) return;
    button.replaceChildren(icon(document, "check", 13));
    setTimeout(() => button.replaceChildren(icon(document, "copy", 13)), COPIED_FEEDBACK);
  }
}
