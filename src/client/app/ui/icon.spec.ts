import { ChangeDetectionStrategy, Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { settle } from "../testing/component-harness";
import { Icon, iconElement } from "./icon";
import type { IconName } from "./icon-data";

@Component({
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg gd-icon class="mine" [name]="name()" [size]="14"></svg>
    <svg gd-icon name="git-merge" aria-label="Merge commit"></svg>
  `,
})
class Host {
  readonly name = signal<IconName>("check");
}

describe("Icon", () => {
  it("draws the named icon the way Lucide does, hidden from screen readers", async () => {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    const svg = (fixture.nativeElement as HTMLElement).querySelector("svg")!;
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(svg.getAttribute("stroke")).toBe("currentColor");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect([...svg.classList].sort()).toEqual(["lucide", "lucide-check", "mine"]);
    expect(svg.innerHTML).toBe('<path d="M20 6 9 17l-5-5"></path>');

    fixture.componentInstance.name.set("x");
    await settle(fixture);
    expect(svg.querySelectorAll("path")).toHaveLength(2);
    expect([...svg.classList].sort()).toEqual(["lucide", "lucide-x", "mine"]);
  });

  it("is an image when it has a label", async () => {
    const fixture = TestBed.createComponent(Host);
    await settle(fixture);
    const svg = (fixture.nativeElement as HTMLElement).querySelectorAll("svg")[1]!;
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.hasAttribute("aria-hidden")).toBe(false);
  });

  it("draws icons for DOM outside Angular", () => {
    const svg = iconElement("chevron-right", 12);
    expect(svg.getAttribute("width")).toBe("12");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.querySelector("path")!.getAttribute("d")).toBe("m9 18 6-6-6-6");
  });
});
