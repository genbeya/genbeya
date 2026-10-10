import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../testing/component-harness";
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
