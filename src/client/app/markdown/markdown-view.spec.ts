import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { openRepository, settle } from "../testing/component-harness";
import type { LinkTarget } from "./link-target";
import { MarkdownView } from "./markdown-view";

@Component({
  imports: [MarkdownView],
  template: `<gd-markdown [source]="source()" path="docs/Guide/Page.md" [checkboxes]="true" (linkClicked)="links.push($event)" (checkboxToggled)="toggles.push($event)" />`,
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
});
