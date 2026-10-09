/**
 * Rendered Markdown: GitDesk's wiki syntax, highlighted code, diagrams and
 * repository images. Links and checkboxes are reported, not followed.
 */
import { ChangeDetectionStrategy, Component, DestroyRef, effect, ElementRef, inject, input, output, untracked } from "@angular/core";
import type { Scope } from "../../../contracts/model";
import { Clipboard } from "../core/clipboard";
import { Session } from "../core/session";
import { WorkspaceApi } from "../core/workspace-api";
import { Theme } from "../core/theme";
import { Diagrams } from "./diagrams";
import { resolveHref, type LinkTarget } from "./link-target";
import { icon, renderMarkdownTree, type Diagram, type RepositoryImage } from "./markdown-dom";
import { parseMarkdown, type GitdeskOptions } from "./markdown-pipeline";

const COPIED_FEEDBACK = 1200;

@Component({
  selector: "gd-markdown",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: "markdown selectable", "(click)": "click($event)", "(keydown)": "key($event)" },
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
  private readonly theme = inject(Theme);
  private objectUrls: string[] = [];
  /** Images by path, so re-renders (typing in the preview) do not read them again. Cleared when the repository changes. */
  private images = new Map<string, Promise<string>>();
  /** Renders count up, so a slow image or diagram never lands in a newer render. */
  private generation = 0;

  constructor() {
    effect(() => {
      const tree = parseMarkdown(this.source(), this.links());
      const rendered = renderMarkdownTree(tree, document, { path: this.path(), interactiveCheckboxes: this.checkboxes() });
      // Diagrams follow the theme.
      this.theme.resolved();
      untracked(() => this.show(rendered.fragment, rendered.images, rendered.diagrams));
    });
    const session = inject(Session);
    effect(() => {
      void session.snapshot()?.version;
      this.images = new Map();
    });
    inject(DestroyRef).onDestroy(() => {
      // Late images and diagrams must not land after this.
      this.generation++;
      this.revoke();
    });
  }

  private show(fragment: DocumentFragment, images: readonly RepositoryImage[], diagrams: readonly Diagram[]) {
    const generation = ++this.generation;
    this.revoke();
    this.host.replaceChildren(fragment);
    this.rendered.emit(this.host);
    for (const image of images) void this.load(image, generation);
    for (const diagram of diagrams) void this.draw(diagram, generation);
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

  private async copy(button: HTMLElement) {
    if (!(await this.clipboard.copy(button.dataset["copy"] ?? ""))) return;
    button.replaceChildren(icon(document, "check", 13));
    setTimeout(() => button.replaceChildren(icon(document, "copy", 13)), COPIED_FEEDBACK);
  }
}
