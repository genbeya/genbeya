import { TestBed } from "@angular/core/testing";
import { settle } from "../../testing/component-harness";
import { ImageComparison } from "./image-comparison";

const BEFORE = "data:image/png;base64,iVBORw==";
const AFTER = "data:image/png;base64,iVBORw0KGgo=";

async function swipe() {
  const fixture = TestBed.createComponent(ImageComparison);
  fixture.componentRef.setInput("original", BEFORE);
  fixture.componentRef.setInput("modified", AFTER);
  fixture.componentRef.setInput("mode", "swipe");
  fixture.componentRef.setInput("name", "icon.png");
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const slider = element.querySelector<HTMLElement>("[role=slider]")!;
  const load = async (selector: string, width: number, height: number) => {
    const image = element.querySelector<HTMLImageElement>(selector)!;
    Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
    image.dispatchEvent(new Event("load"));
    await settle(fixture);
  };
  return { fixture, element, slider, load };
}

describe("ImageComparison", () => {
  it("moves the divider with the arrow keys, Home and End", async () => {
    const { fixture, slider } = await swipe();
    const press = async (key: string) => {
      slider.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      await settle(fixture);
      return slider.getAttribute("aria-valuenow");
    };
    expect(await press("ArrowRight")).toBe("55");
    expect(await press("ArrowLeft")).toBe("50");
    expect(await press("End")).toBe("100");
    expect(await press("ArrowRight")).toBe("100");
    expect(await press("Home")).toBe("0");
    expect(slider.style.left).toBe("0%");
  });

  it("moves the divider where the pointer drags it", async () => {
    const { fixture, element, slider } = await swipe();
    const stage = element.querySelector<HTMLElement>(".swipe")!;
    stage.getBoundingClientRect = () => ({
      left: 100,
      width: 200,
      top: 0,
      height: 100,
      right: 300,
      bottom: 100,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    });
    const pointer = (type: string, clientX: number) => stage.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true }));
    pointer("pointerdown", 150);
    await settle(fixture);
    expect(slider.getAttribute("aria-valuenow")).toBe("25");
    pointer("pointermove", 400);
    await settle(fixture);
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
    pointer("pointerup", 400);
    pointer("pointermove", 200);
    await settle(fixture);
    expect(slider.getAttribute("aria-valuenow")).toBe("100");
  });

  it("shows both versions at one scale, as wide as the wider one", async () => {
    const { element, load } = await swipe();
    await load(".swipe-before", 50, 50);
    await load(".swipe-after", 200, 100);
    expect(element.querySelector<HTMLElement>(".swipe")!.style.width).toBe("200px");
    expect(element.querySelector<HTMLElement>(".swipe-before")!.style.width).toBe("25%");
    expect(element.querySelector<HTMLElement>(".swipe-after")!.style.width).toBe("100%");
    expect(element.querySelector(".swipe-facts")!.textContent).toContain("50 × 50 px · 4 B");
    expect(element.querySelector(".swipe-facts")!.textContent).toContain("200 × 100 px · 8 B");
  });
});
