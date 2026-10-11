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
  const items = [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container :is([role=menuitem], [role=menuitemradio])")];
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

  it("marks the current icon as checked, and moves through the grid with the arrow keys", async () => {
    const { item } = await render("bug", "Progress");
    expect(item("Bug")!.getAttribute("role")).toBe("menuitemradio");
    expect(item("Bug")!.getAttribute("aria-checked")).toBe("true");
    expect(item("Sparkles")!.getAttribute("aria-checked")).toBe("false");
    const key = (from: string, key: string) => item(from)!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    key("Bug", "ArrowRight");
    expect(document.activeElement).toBe(item("Sparkles"));
    key("Sparkles", "ArrowDown");
    expect(document.activeElement).toBe(item(ICON_NAMES[8]!.replace(/-/g, " ").replace(/^\w/, (letter) => letter.toUpperCase())));
    key("Bug", "ArrowUp");
    expect(document.activeElement).toBe(item("Progress"));
    key("Sparkles", "ArrowLeft");
    expect(document.activeElement).toBe(item("Bug"));
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
    expect(knownIcon("bug")).toBe("bug");
    expect(knownIcon("not-an-icon")).toBeUndefined();
    expect(iconFor("not-an-icon")).toBe("circle-dot");
  });
});
