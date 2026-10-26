/**
 * Rendered Markdown: Genbeya's wiki syntax, highlighted code, diagrams, math
 * and repository images. Links and checkboxes are reported, not followed;
 * mentions show who they mean; images and diagrams open zoomed.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  untracked,
} from "@angular/core";
import type { Scope } from "../../../contracts/model";
import { pinnedText } from "../../../utilities/references";
import { Clipboard } from "../core/clipboard";
import { Dialogs } from "../core/dialogs";
import { Session } from "../core/session";
import { WorkspaceApi } from "../core/workspace-api";
import { Theme } from "../core/theme";
import { Diagrams } from "./diagrams";
import { resolveHref, type LinkTarget } from "./link-target";
import { checkPinned, fillEmbed, type EmbeddedFiles } from "./file-embeds";
import { footnotePreview } from "./footnotes";
import { icon, renderMarkdownTree, type Diagram, type Formula, type RenderedMarkdown, type RepositoryImage } from "./markdown-dom";
import { parseMarkdown, type GenbeyaOptions } from "./markdown-pipeline";
import { Typesetter } from "./typesetter";

const COPIED_FEEDBACK = 1200;

/** What a zoomable picture of the page is: a repository image, or a drawn diagram with its source. */
type Picture = { readonly path: string } | { readonly diagram: Diagram; readonly svg: string };

/** A button that opens a picture zoomed: for the keyboard, and for images in links, whose click follows the link. */
function zoomButton(label: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "md-zoom";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(document, "zoomIn", 14));
  return button;
}

/** Gives a repository image its zoom button, beside the link it is in rather than inside it. */
function makeZoomable(image: HTMLImageElement) {
  const link = image.closest("a");
  const target = link ?? image;
  const wrapper = document.createElement("span");
  wrapper.className = link ? "md-zoomable is-linked" : "md-zoomable";
  target.replaceWith(wrapper);
  wrapper.append(target, zoomButton("Zoom image"));
}

@Component({
  selector: "gd-markdown",
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: "markdown selectable",
    "(click)": "click($event)",
    "(keydown)": "key($event)",
    "(mouseover)": "hover($event)",
    "(mouseout)": "unhover($event)",
    "(focusin)": "hover($event)",
    "(focusout)": "unhover($event)",
  },
  template: "",
})
export class MarkdownView {
  readonly source = input.required<string>();
  /** Repository path of the document, for relative links and images. */
  readonly path = input.required<string>();
  /** Where the document's images are read from. */
  readonly scope = input<Scope>("content");
  readonly links = input<GenbeyaOptions>({});
  /** Makes task-list checkboxes clickable. */
  readonly checkboxes = input(false);
  /** Marks blocks with their source lines (see source-lines.ts), counting this many lines of the file above `source`, such as a frontmatter left out. */
  readonly lineOffset = input<number | undefined>(undefined);
  readonly linkClicked = output<LinkTarget>();
  readonly checkboxToggled = output<number>();
  /** After every render, with the element holding the content (for outlines and anchors). */
  readonly rendered = output<HTMLElement>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly api = inject(WorkspaceApi);
  private readonly clipboard = inject(Clipboard);
  private readonly dialogs = inject(Dialogs);
  private readonly diagrams = inject(Diagrams);
  private readonly typesetter = inject(Typesetter);
  private readonly theme = inject(Theme);
  private readonly injector = inject(Injector);
  private objectUrls: string[] = [];
  /** Images by path, so re-renders (typing in the preview) do not read them again. Cleared when the repository changes. */
  private images = new Map<string, Promise<string>>();
  /** Embedded files by path, like images. */
  private files = new Map<string, Promise<string>>();
  /** Files at a revision, for pinned references and embeds, by revision and path. */
  private pinned = new Map<string, Promise<string>>();
  /** Embeds and pinned references read files through the managers, once per repository version. */
  private readonly embedded: EmbeddedFiles = {
    file: (path) => this.file(path),
    fileAt: (path, revision) => this.fileAt(path, revision),
  };
  /** Renders count up, so a slow image or diagram never lands in a newer render. */
  private generation = 0;
  /** The footnote reference under the pointer and the preview of its note. */
  private previewed: Element | null = null;
  private preview: HTMLElement | null = null;
  /** The images and diagrams on the page that open zoomed. */
  private pictures = new WeakMap<HTMLImageElement, Picture>();

  constructor() {
    effect(() => {
      const tree = parseMarkdown(this.source(), this.links());
      const lineOffset = this.lineOffset();
      const rendered = renderMarkdownTree(tree, document, {
        path: this.path(),
        interactiveCheckboxes: this.checkboxes(),
        ...(lineOffset === undefined ? {} : { lineOffset }),
      });
      // Diagrams follow the theme.
      this.theme.resolved();
      untracked(() => this.show(rendered));
    });
    const session = inject(Session);
    effect(() => {
      void session.snapshot()?.version;
      this.images = new Map();
      this.files = new Map();
      this.pinned = new Map();
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
    this.pictures = new WeakMap();
    for (const image of images) {
      this.pictures.set(image.element, { path: image.path });
      makeZoomable(image.element);
    }
    this.host.replaceChildren(fragment);
    this.rendered.emit(this.host);
    for (const image of images) void this.load(image, generation);
    for (const diagram of diagrams) void this.draw(diagram, generation);
    this.typesetter.keep(formulas.length);
    for (const formula of formulas) void this.typeset(formula, generation);
    const current = () => generation === this.generation;
    for (const embed of embeds) void fillEmbed(embed, this.embedded, current);
    for (const link of this.host.querySelectorAll<HTMLAnchorElement>("a.md-ref-pinned"))
      void checkPinned(link, this.path(), this.embedded, current);
  }

  /** A file as committed in `revision`, read once like files. */
  private fileAt(path: string, revision: string): Promise<string> {
    const pinned = this.pinned;
    const key = `${revision}:${path}`;
    let content = pinned.get(key);
    if (!content) {
      content = this.api.versionControl.fileAt(revision, path).then((file) => pinnedText(file, path, revision));
      content.catch(() => pinned.delete(key));
      pinned.set(key, content);
    }
    return content;
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
      if (generation !== this.generation) return;
      image.element.closest(".md-zoomable")?.querySelector(":scope > .md-zoom")?.remove();
      image.element.replaceWith(this.missingImage(image));
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

  private async draw(diagram: Diagram, generation: number) {
    const { element, language, source } = diagram;
    try {
      const { svg, isError } = await this.diagrams.draw(language, source);
      if (generation !== this.generation) return;
      const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
      this.objectUrls.push(url);
      const image = document.createElement("img");
      image.src = url;
      image.alt = `${language === "mermaid" ? "Mermaid" : "PlantUML"} diagram`;
      this.pictures.set(image, { diagram, svg });
      element.classList.toggle("is-error", isError);
      element.classList.add("md-zoomable");
      element.replaceChildren(image, zoomButton("Zoom diagram"));
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
    const zoom = target.closest<HTMLElement>(".md-zoom");
    const anchor = target.closest("a");
    // An image in a link follows the link; its zoom button, beside the link, opens it zoomed.
    if (zoom || !anchor || !this.host.contains(anchor)) {
      const image = zoom ? zoom.parentElement?.querySelector<HTMLImageElement>(":scope > img, :scope > a img") : target.closest("img");
      if (image) void this.zoom(image);
      return;
    }
    event.preventDefault();
    const href = anchor.getAttribute("href");
    if (!href) return;
    const link = resolveHref(this.path(), href);
    if (link.kind === "anchor") this.goTo(link.id);
    else if (link.kind === "person") void this.showPerson(anchor, link.handle);
    else this.linkClicked.emit(link);
  }

  protected key(event: KeyboardEvent) {
    const checkbox = (event.target as Element).closest<HTMLElement>(".md-check.is-interactive");
    if (checkbox && (event.key === " " || event.key === "Enter")) {
      event.preventDefault();
      this.checkboxToggled.emit(Number(checkbox.dataset["offset"]));
    }
    // Escape puts a footnote's preview away, as for one under the pointer.
    if (event.key === "Escape" && this.preview) this.hidePreview();
  }

  /** Opens an image or diagram of the page over the window, zoomable; diagrams with their source. */
  private async zoom(image: HTMLImageElement) {
    const picture = this.pictures.get(image);
    // An image still loading has nothing to show yet.
    if (!picture || !image.getAttribute("src")) return;
    const shown = { width: image.clientWidth || image.naturalWidth || 480, height: image.clientHeight || image.naturalHeight || 320 };
    const { openImageZoom } = await import("./image-zoom");
    if ("diagram" in picture)
      return openImageZoom(this.dialogs, {
        title: image.alt,
        image: { svg: picture.svg },
        shown,
        source: { language: picture.diagram.language, text: picture.diagram.source },
      });
    const name = picture.path.slice(picture.path.lastIndexOf("/") + 1);
    return openImageZoom(this.dialogs, {
      title: image.alt || name,
      image: { url: image.src, vector: /\.svg$/i.test(name) },
      shown,
    });
  }

  /** Scrolls to the element with `id` and moves the focus there, so the keyboard goes on from it (a footnote's back link). */
  private goTo(id: string) {
    const target = this.host.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }

  private async showPerson(anchor: HTMLElement, handle: string) {
    const person = this.links().people?.find((candidate) => candidate.handle === handle);
    if (!person) return;
    const { openMentionPopover } = await import("./mention-popover");
    openMentionPopover(this.injector, anchor, person);
  }

  /** Footnote references show their note while the pointer is on them or they have the focus. */
  protected hover(event: MouseEvent | FocusEvent) {
    const reference = (event.target as Element).closest<HTMLAnchorElement>("a[data-footnote-ref]");
    if (!reference || this.previewed === reference) return;
    this.hidePreview();
    this.previewed = reference;
    this.preview = footnotePreview(reference, this.host);
    // Screen readers read the note with the reference.
    if (this.preview) reference.setAttribute("aria-describedby", this.preview.id);
  }

  protected unhover(event: MouseEvent | FocusEvent) {
    const reference = (event.target as Element).closest("a[data-footnote-ref]");
    if (!reference || reference.contains(event.relatedTarget as Node | null)) return;
    this.hidePreview();
  }

  private hidePreview() {
    this.previewed?.removeAttribute("aria-describedby");
    this.preview?.remove();
    this.preview = this.previewed = null;
  }

  private async copy(button: HTMLElement) {
    if (!(await this.clipboard.copy(button.dataset["copy"] ?? ""))) return;
    button.replaceChildren(icon(document, "check", 13));
    setTimeout(() => button.replaceChildren(icon(document, "copy", 13)), COPIED_FEEDBACK);
  }
}
