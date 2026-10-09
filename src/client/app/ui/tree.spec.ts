import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { filterTree, Tree, type TreeItem } from "./tree";

const items: TreeItem<string>[] = [
  {
    key: "docs",
    label: "docs",
    selectable: false,
    data: "docs",
    children: [
      { key: "docs/Home.md", label: "Home", data: "home" },
      { key: "docs/Guide", label: "Guide", data: "guide", children: [{ key: "docs/Guide/Setup.md", label: "Setup", data: "setup" }] },
    ],
  },
  { key: "README.md", label: "README", data: "readme" },
];

@Component({
  imports: [Tree],
  template: `
    <gd-tree label="Files" [items]="items" [selected]="selected()" (selectItem)="chosen.set($event.data)">
      <ng-template let-item
        ><span class="tree-label">{{ item.label }}</span></ng-template
      >
    </gd-tree>
  `,
})
class Host {
  readonly items = items;
  readonly selected = signal<string | null>(null);
  readonly chosen = signal<string | null>(null);
}

async function render() {
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const labels = () => [...fixture.nativeElement.querySelectorAll(".tree-row")].map((row: Element) => row.textContent!.trim());
  const row = (label: string) =>
    [...fixture.nativeElement.querySelectorAll(".tree-row")].find((r: Element) => r.textContent!.trim() === label) as HTMLElement;
  return { fixture, labels, row };
}

describe("Tree", () => {
  it("shows top-level rows and expands folders without selecting them", async () => {
    const { fixture, labels, row } = await render();
    expect(labels()).toEqual(["docs", "README"]);
    row("docs").click();
    await fixture.whenStable();
    expect(labels()).toEqual(["docs", "Home", "Guide", "README"]);
    expect(fixture.componentInstance.chosen()).toBeNull();
  });

  it("selects rows by click and Enter", async () => {
    const { fixture, row } = await render();
    row("README").click();
    expect(fixture.componentInstance.chosen()).toBe("readme");
    row("docs").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    await fixture.whenStable();
    row("Home").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(fixture.componentInstance.chosen()).toBe("home");
  });

  it("opens the ancestors of the selection", async () => {
    const { fixture, labels } = await render();
    fixture.componentInstance.selected.set("docs/Guide/Setup.md");
    await fixture.whenStable();
    expect(labels()).toEqual(["docs", "Home", "Guide", "Setup", "README"]);
    expect(fixture.nativeElement.querySelector(".is-selected").textContent.trim()).toBe("Setup");
  });
});

describe("filterTree", () => {
  it("keeps matches and the folders leading to them", () => {
    const result = filterTree(items, "setup");
    expect(result.map((i) => i.label)).toEqual(["docs"]);
    expect(result[0]!.children!.map((i) => i.label)).toEqual(["Guide"]);
    expect(filterTree(items, " ")).toHaveLength(2);
  });
});
