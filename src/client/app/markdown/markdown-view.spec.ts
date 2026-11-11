import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../testing/component-harness";
import { ImageZoom } from "./image-zoom";
import type { LinkTarget } from "./link-target";
import { MarkdownView } from "./markdown-view";

@Component({
  imports: [MarkdownView],
  template: `<gd-markdown
    [source]="source()"
    path="docs/Guide/Page.md"
    [checkboxes]="true"
    (linkClicked)="links.push($event)"
    (checkboxToggled)="toggles.push($event)"
  />`,
})
class Host {
  readonly source = signal("");
  readonly links: LinkTarget[] = [];
  readonly toggles: number[] = [];
}

async function render(source: string) {
  const harness = await openRepository();
  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.source.set(source);
  await settle(fixture);
  return { ...harness, fixture, element: fixture.nativeElement as HTMLElement, host: fixture.componentInstance };
}

describe("MarkdownView", () => {
  it("reports links resolved against the document", async () => {
    const { element, host } = await render("[Other](../Other.md#part) [Web](https://example.com)");
    for (const anchor of element.querySelectorAll("a")) anchor.click();
    expect(host.links).toEqual([
      { kind: "file", path: "docs/Other.md", anchor: "part" },
      { kind: "external", url: "https://example.com" },
    ]);
  });

  it("reports checkbox clicks and keys with their source offset", async () => {
    const source = "- [ ] one\n- [x] two\n";
    const { element, host } = await render(source);
    const boxes = element.querySelectorAll<HTMLElement>(".md-check");
    boxes[0]!.click();
    boxes[1]!.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(host.toggles).toEqual([0, source.indexOf("- [x]")]);
  });

  it("loads repository images through the content manager", async () => {
    const { element, managers, fixture } = await render("![Logo](logo.png)");
    managers.content.image.mockResolvedValue("data:image/png;base64,AA==");
    fixture.componentInstance.source.set("![Logo](logo.png) ");
    await settle(fixture);
    expect(managers.content.image).toHaveBeenCalledWith("w1", "content", "docs/Guide/logo.png");
    expect(element.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AA==");
  });

  it("draws diagrams as images", async () => {
    const { element } = await render("```plantuml\nA -> B\n```");
    await vi.waitFor(() => expect(element.querySelector(".md-diagram img")?.getAttribute("alt")).toBe("PlantUML diagram"));
  });

  it("opens a diagram zoomed with its source on a click, or with its button", async () => {
    const { element, dialogs } = await render("```plantuml\nA -> B\n```");
    await vi.waitFor(() => expect(element.querySelector(".md-diagram img")).not.toBeNull());
    element.querySelector<HTMLElement>(".md-diagram img")!.click();
    await vi.waitFor(() => expect(dialogs.open).toHaveBeenCalledTimes(1));
    expect(dialogs.open).toHaveBeenCalledWith(
      ImageZoom,
      expect.objectContaining({
        title: "PlantUML diagram",
        image: { svg: "<svg></svg>" },
        source: { language: "plantuml", text: "A -> B" },
      }),
      expect.objectContaining({ panel: "zoom-pane" }),
    );
    const button = element.querySelector<HTMLButtonElement>(".md-diagram .md-zoom")!;
    expect(button.getAttribute("aria-label")).toBe("Zoom diagram");
    button.click();
    await vi.waitFor(() => expect(dialogs.open).toHaveBeenCalledTimes(2));
  });

  it("opens repository images zoomed, except in links, which zoom with a button beside the link", async () => {
    const harness = await openRepository();
    harness.managers.content.image.mockImplementation(async (_id: string, _scope: string, path: string) => `data:${path}`);
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.source.set("![Logo](logo.png) [![](badge.svg)](Other.md)");
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    const [logo, badge] = element.querySelectorAll<HTMLImageElement>("img");
    logo!.click();
    await vi.waitFor(() => expect(harness.dialogs.open).toHaveBeenCalledTimes(1));
    expect(harness.dialogs.open.mock.calls[0]![1]).toEqual(
      expect.objectContaining({ title: "Logo", image: { url: "data:docs/Guide/logo.png", vector: false } }),
    );
    expect(harness.dialogs.open.mock.calls[0]![1]).not.toHaveProperty("source");
    // The link wins; its button, outside it, zooms.
    badge!.click();
    expect(fixture.componentInstance.links).toEqual([{ kind: "file", path: "docs/Guide/Other.md" }]);
    const wrapper = badge!.closest(".md-zoomable")!;
    expect(wrapper.classList.contains("is-linked")).toBe(true);
    const button = wrapper.querySelector<HTMLButtonElement>(":scope > .md-zoom")!;
    expect([button.closest("a"), button.getAttribute("aria-label")]).toEqual([null, "Zoom image"]);
    button.click();
    await vi.waitFor(() => expect(harness.dialogs.open).toHaveBeenCalledTimes(2));
    expect(harness.dialogs.open.mock.calls[1]![1]).toEqual(
      expect.objectContaining({ title: "badge.svg", image: { url: "data:docs/Guide/badge.svg", vector: true } }),
    );
  });

  it("leaves images that do not load without a zoom button", async () => {
    const harness = await openRepository();
    harness.managers.content.image.mockRejectedValue(new Error("missing"));
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.source.set("![Logo](logo.png)");
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect([element.querySelector(".md-remote-image")?.textContent?.trim(), element.querySelector(".md-zoom")]).toEqual(["Logo", null]);
  });

  it("typesets math, and marks formulas KaTeX cannot read", async () => {
    const { element } = await render("Inline $x^2$ and $\\frac{$.\n\n$$\n\\sum_i a_i\n$$");
    await vi.waitFor(() => expect(element.querySelectorAll("math")).toHaveLength(2));
    expect(element.querySelector("p > .md-math > math msup")).not.toBeNull();
    expect(element.querySelector(".md-math.is-display > math")?.getAttribute("display")).toBe("block");
    const error = element.querySelector<HTMLElement>(".md-math-error")!;
    expect([error.textContent, error.title]).toEqual(["\\frac{", expect.stringContaining("KaTeX parse error")]);
  });

  it("wraps long lines of code on request", async () => {
    const { element } = await render("```\nx\n```");
    const wrap = element.querySelector<HTMLElement>("[aria-label='Wrap lines']")!;
    wrap.click();
    expect([element.querySelector(".md-code")?.classList.contains("is-wrapped"), wrap.getAttribute("aria-pressed")]).toEqual([
      true,
      "true",
    ]);
    wrap.click();
    expect(element.querySelector(".md-code")?.classList.contains("is-wrapped")).toBe(false);
  });

  it("previews footnotes at their reference and links back", async () => {
    const { element, host } = await render("Claim.[^1]\n\n[^1]: The **source**.");
    const reference = element.querySelector<HTMLAnchorElement>("a[data-footnote-ref]")!;
    reference.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const preview = element.querySelector(".md-footnote-preview")!;
    expect([preview.textContent?.trim(), preview.querySelector("strong")?.textContent]).toEqual(["The source.", "source"]);
    expect(preview.querySelector("[data-footnote-backref], [id]")).toBeNull();
    reference.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
    expect(element.querySelector(".md-footnote-preview")).toBeNull();
    const note = element.querySelector<HTMLElement>(`#${CSS.escape(reference.getAttribute("href")!.slice(1))}`)!;
    note.scrollIntoView = vi.fn();
    reference.click();
    expect(note.scrollIntoView).toHaveBeenCalled();
    // The keyboard goes on from the note, to its link back.
    expect(document.activeElement).toBe(note);
    expect(host.links).toEqual([]);
  });

  it("previews a footnote while its reference has the focus, describing the reference", async () => {
    const { element } = await render("Claim.[^1]\n\n[^1]: The source.");
    const reference = element.querySelector<HTMLAnchorElement>("a[data-footnote-ref]")!;
    reference.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const preview = element.querySelector<HTMLElement>(".md-footnote-preview")!;
    expect(preview.getAttribute("role")).toBe("tooltip");
    expect(reference.getAttribute("aria-describedby")).toBe(preview.id);
    reference.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(element.querySelector(".md-footnote-preview")).toBeNull();
    expect(reference.hasAttribute("aria-describedby")).toBe(false);
    reference.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(element.querySelector(".md-footnote-preview")).not.toBeNull();
    reference.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(element.querySelector(".md-footnote-preview")).toBeNull();
  });

  it("re-renders when the source changes", async () => {
    const { element, fixture } = await render("# One");
    fixture.componentInstance.source.set("# Two");
    await settle(fixture);
    expect(element.querySelector("h1")?.textContent).toBe("Two");
  });

  it("embeds lines of a repository file and links them to the file", async () => {
    const harness = await openRepository({ files: [{ name: "src", path: "src", children: [{ name: "app.ts", path: "src/app.ts" }] }] });
    harness.managers.content.read.mockResolvedValue({ scope: "repo", path: "src/app.ts", content: "one\ntwo\nthree\n", hash: "h" });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.source.set("![[src/app.ts#L2-L3]]");
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(harness.managers.content.read).toHaveBeenCalledWith("w1", "repo", "src/app.ts");
    const title = element.querySelector(".md-embed-title")!;
    expect([title.getAttribute("href"), title.textContent]).toEqual(["/src/app.ts#L2-L3", "src/app.ts:2–3"]);
    expect(element.querySelector(".md-embed pre")?.textContent).toBe("two\nthree\n");
    title.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fixture.componentInstance.links).toEqual([{ kind: "file", path: "src/app.ts", anchor: "L2-L3" }]);
  });

  it("embeds lines as committed in a revision, and says when they read differently now", async () => {
    const harness = await openRepository({ files: [{ name: "src", path: "src", children: [{ name: "app.ts", path: "src/app.ts" }] }] });
    harness.managers.versionControl.fileAt.mockResolvedValue({ commit: "c".repeat(40), content: "one\ntwo\nthree\n" });
    harness.managers.content.read.mockResolvedValue({ scope: "repo", path: "src/app.ts", content: "one\nTWO\nthree\n", hash: "h" });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.source.set("![[src/app.ts#L2-L3@v1.0]]\n\n![[src/app.ts#L3@v1.0]]");
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(harness.managers.versionControl.fileAt).toHaveBeenCalledWith("w1", "v1.0", "src/app.ts");
    const [changed, same] = [...element.querySelectorAll(".md-embed")];
    const title = changed!.querySelector(".md-embed-title")!;
    expect([title.getAttribute("href"), title.textContent]).toEqual(["/src/app.ts#L2-L3@v1.0", "src/app.ts:2–3v1.0"]);
    expect(changed!.querySelector("pre")?.textContent).toBe("two\nthree\n");
    expect(changed!.querySelector(".md-embed-note")?.textContent).toBe("Changed since v1.0. Show the current version");
    expect(same!.querySelector(".md-embed-note")).toBeNull();
    changed!.querySelector<HTMLElement>(".md-embed-note a")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(fixture.componentInstance.links).toEqual([{ kind: "file", path: "src/app.ts", anchor: "L2-L3" }]);
  });

  it("marks pinned references whose lines changed, or whose revision is missing", async () => {
    const harness = await openRepository({ files: [{ name: "src", path: "src", children: [{ name: "app.ts", path: "src/app.ts" }] }] });
    harness.managers.versionControl.fileAt.mockImplementation(async (_id: string, revision: string) =>
      revision === "v1.0" ? { commit: "c".repeat(40), content: "one\ntwo\n" } : { commit: null, content: null },
    );
    harness.managers.content.read.mockResolvedValue({ scope: "repo", path: "src/app.ts", content: "one\n2\n", hash: "h" });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.source.set("[[src/app.ts#L1@v1.0]] [[src/app.ts#L2@v1.0]] [[src/app.ts#L1@v9]]");
    await settle(fixture);
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>("a.md-ref-pinned")];
    expect(links.map((link) => [link.classList.contains("is-outdated"), link.classList.contains("md-ref-missing"), link.title])).toEqual([
      [false, false, "src/app.ts:1 as of v1.0"],
      [true, false, "src/app.ts:2 as of v1.0; changed since"],
      [false, true, "v9 is not in this clone. Fetch it, or check the reference."],
    ]);
  });

  it("says when embedded lines do not exist", async () => {
    const harness = await openRepository();
    harness.managers.content.read.mockResolvedValue({ scope: "repo", path: "src/app.ts", content: "one\n", hash: "h" });
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.source.set("![[src/app.ts#L5]]");
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector(".md-embed.is-error")?.textContent).toContain(
      "src/app.ts has only 1 line.",
    );
  });
});
