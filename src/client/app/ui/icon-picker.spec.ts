import { TestBed } from "@angular/core/testing";
import { settle } from "../testing/component-harness";
import { IconPicker } from "./icon-picker";
import { ICON_NAMES, iconFor, knownIcon } from "./icons";

async function render(value: string | null, noneLabel?: string) {
  const fixture = TestBed.createComponent(IconPicker);
  fixture.componentRef.setInput("value", value);
  fixture.componentRef.setInput("label", "Icon of Bug");
  if (noneLabel) fixture.componentRef.setInput("noneLabel", noneLabel);
  const chosen: (string | null)[] = [];
  fixture.componentInstance.changed.subscribe((name) => chosen.push(name));
  await settle(fixture);
  const trigger = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>("button[aria-label='Icon of Bug']")!;
  trigger.click();
  await settle(fixture);
  const items = [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container [role=menuitem]")];
  return {
    trigger,
    items,
    chosen,
    item: (name: string) => items.find((item) => (item.getAttribute("aria-label") ?? item.textContent!.trim()).startsWith(name)),
  };
}

describe("IconPicker", () => {
  afterEach(() => document.querySelector(".cdk-overlay-container")?.replaceChildren());

  it("offers the curated icons and marks the current one", async () => {
    const { items, item, chosen } = await render("bug");
    expect(items).toHaveLength(ICON_NAMES.length);
    expect(item("Bug")!.classList).toContain("is-active");
    item("Trending up")!.click();
    expect(chosen).toEqual(["trending-up"]);
  });

  it("offers no icon when asked to", async () => {
    const { items, item, chosen } = await render(null, "Progress");
    expect(items).toHaveLength(ICON_NAMES.length + 1);
    item("Progress")!.click();
    expect(chosen).toEqual([null]);
  });
});

describe("icons", () => {
  it("are found by their Lucide name, with a generic one for others", () => {
    expect(knownIcon("bug")!.icon.name).toBe("bug");
    expect(knownIcon("not-an-icon")).toBeUndefined();
    expect(iconFor("not-an-icon").icon.name).toBe("circle-dot");
  });
});
