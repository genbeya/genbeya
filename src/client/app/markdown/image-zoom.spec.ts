import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import { settle } from "../testing/component-harness";
import { centred, fitScale, ImageZoom, keptInView, zoomedAround, type ZoomedPicture } from "./image-zoom";

const diagram: ZoomedPicture = {
  title: "Mermaid diagram",
  image: { svg: "<svg></svg>" },
  shown: { width: 400, height: 120 },
  source: { language: "mermaid", text: "flowchart LR\n  a --> b" },
};
const photo: ZoomedPicture = {
  title: "Board",
  image: { url: "data:image/png;base64,AA==", vector: false },
  shown: { width: 400, height: 120 },
};

/** The popup on a stage of 1048 × 648 pixels (1000 × 600 inside the margins), with a picture of 2000 × 600. */
async function open(picture: ZoomedPicture) {
  URL.createObjectURL ??= () => "blob:diagram";
  URL.revokeObjectURL ??= () => undefined;
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_DATA, useValue: picture },
      { provide: DialogRef, useValue: { close: vi.fn() } },
    ],
  });
  const fixture = TestBed.createComponent(ImageZoom);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const stage = () => element.querySelector<HTMLElement>(".zoom-stage")!;
  const image = () => stage().querySelector("img")!;
  const load = async () => {
    Object.defineProperties(stage(), { clientWidth: { value: 1048 }, clientHeight: { value: 648 } });
    Object.defineProperties(image(), { naturalWidth: { value: 2000 }, naturalHeight: { value: 600 } });
    image().dispatchEvent(new Event("load"));
    await settle(fixture);
  };
  const level = () => element.querySelector(".zoom-level")?.textContent?.trim();
  const press = async (key: string, target: Element = stage()) => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    await settle(fixture);
  };
  const button = (name: string) => [...element.querySelectorAll("button")].find((each) => each.textContent?.trim() === name)!;
  const named = (label: string) => element.querySelector<HTMLButtonElement>(`button[aria-label='${label}']`)!;
  return { fixture, element, stage, image, load, level, press, button, named };
}

/** Where the picture's top left corner is, from its transform. */
const offset = (image: HTMLElement) => image.style.transform.match(/-?[\d.]+/g)!.map(Number);

function pointer(type: string, x: number, y: number, id = 1) {
  return Object.assign(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }), { pointerId: id });
}

describe("zoom geometry", () => {
  it("fits a picture inside the margins, but never enlarges it", () => {
    expect(fitScale({ width: 2000, height: 600 }, { width: 1048, height: 648 })).toBe(0.5);
    expect(fitScale({ width: 100, height: 50 }, { width: 1048, height: 648 })).toBe(1);
    expect(centred({ width: 2000, height: 600 }, { width: 1048, height: 648 }, 0.5)).toEqual({ scale: 0.5, x: 24, y: 174 });
  });

  it("zooms around a point, which stays where it is", () => {
    const view = zoomedAround({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
    // The picture's point (100, 50) is still under (100, 50).
    expect([(100 - view.x) / view.scale, (50 - view.y) / view.scale]).toEqual([100, 50]);
  });

  it("keeps a strip of the picture on the stage", () => {
    const stage = { width: 1000, height: 600 };
    const picture = { width: 500, height: 500 };
    expect(keptInView({ scale: 1, x: -2000, y: 5000 }, picture, stage)).toEqual({ scale: 1, x: -452, y: 552 });
    expect(keptInView({ scale: 1, x: 10, y: 20 }, picture, stage)).toEqual({ scale: 1, x: 10, y: 20 });
  });
});

describe("ImageZoom", () => {
  it("opens a diagram fitted, with the switch on Diagram", async () => {
    const { element, stage, image, load, level } = await open(diagram);
    expect(element.querySelector("form")?.getAttribute("aria-label")).toBe("Mermaid diagram");
    const radios = [...element.querySelectorAll("[role=radio]")];
    expect(radios.map((radio) => [radio.textContent?.trim(), radio.getAttribute("aria-checked")])).toEqual([
      ["Source", "false"],
      ["Split", "false"],
      ["Diagram", "true"],
    ]);
    expect([stage().getAttribute("role"), stage().getAttribute("aria-label"), stage().hasAttribute("cdkFocusInitial")]).toEqual([
      "img",
      "Mermaid diagram",
      true,
    ]);
    expect(image().getAttribute("src")).toMatch(/^blob:/);
    await load();
    expect([image().style.width, image().style.height, level()]).toEqual(["1000px", "300px", "50 %"]);
    expect(offset(image())).toEqual([24, 174]);
  });

  it("shows the source read-only, beside the diagram or instead of it", async () => {
    const { element, button, fixture } = await open(diagram);
    button("Source").click();
    await settle(fixture);
    const content = element.querySelector(".cm-content")!;
    expect([content.textContent, content.getAttribute("aria-readonly"), content.getAttribute("aria-label")]).toEqual([
      "flowchart LR  a --> b",
      "true",
      "Source of the Mermaid diagram",
    ]);
    expect(element.querySelector(".zoom-stage")).toBeNull();
    // Without the picture there is nothing to zoom.
    expect(element.querySelector(".zoom-level")).toBeNull();
    button("Split").click();
    await settle(fixture);
    expect([!!element.querySelector(".cm-content"), !!element.querySelector(".zoom-stage")]).toEqual([true, true]);
    expect(element.querySelector(".zoom-body")?.classList.contains("is-split")).toBe(true);
  });

  it("shows an image from the repository without a switch", async () => {
    const { element, image } = await open(photo);
    expect(element.querySelector("[role=radiogroup]")).toBeNull();
    expect(image().getAttribute("src")).toBe("data:image/png;base64,AA==");
  });

  it("zooms with the keys and buttons: + and − step, 1 shows 100 %, 0 fits", async () => {
    const { load, level, press, button, named, fixture } = await open(diagram);
    await load();
    await press("+");
    expect(level()).toBe("63 %");
    await press("-");
    expect(level()).toBe("50 %");
    await press("1");
    expect(level()).toBe("100 %");
    await press("0");
    expect(level()).toBe("50 %");
    named("Zoom in").click();
    await settle(fixture);
    expect(level()).toBe("63 %");
    named("Fit to window").click();
    button("100 %").click();
    await settle(fixture);
    expect(level()).toBe("100 %");
  });

  it("caps raster images at 400 %, while SVG goes further", async () => {
    const raster = await open(photo);
    await raster.load();
    for (let i = 0; i < 20; i++) await raster.press("+");
    expect([raster.level(), raster.named("Zoom in").disabled]).toEqual(["400 %", true]);
    TestBed.resetTestingModule();
    const vector = await open(diagram);
    await vector.load();
    for (let i = 0; i < 20; i++) await vector.press("+");
    expect(Number(vector.level()!.replace(" %", ""))).toBeGreaterThan(400);
  });

  it("zooms with the wheel around the pointer, and pans by dragging", async () => {
    const { stage, image, load, level, fixture } = await open(diagram);
    await load();
    const [x, y] = offset(image());
    // The picture's point under the pointer, at 50 %.
    const spot = [(300 - x!) / 0.5, (200 - y!) / 0.5];
    stage().dispatchEvent(new WheelEvent("wheel", { deltaY: -200, clientX: 300, clientY: 200, bubbles: true, cancelable: true }));
    await settle(fixture);
    const scale = Number(level()!.replace(" %", "")) / 100;
    expect(scale).toBeGreaterThan(0.5);
    const [x2, y2] = offset(image());
    const width = Number.parseFloat(image().style.width) / 2000;
    expect([(300 - x2!) / width, (200 - y2!) / width].map(Math.round)).toEqual(spot.map(Math.round));
    stage().dispatchEvent(pointer("pointerdown", 10, 10));
    stage().dispatchEvent(pointer("pointermove", 40, 30));
    stage().dispatchEvent(pointer("pointerup", 40, 30));
    await settle(fixture);
    expect(offset(image()).map(Math.round)).toEqual([Math.round(x2! + 30), Math.round(y2! + 20)]);
    // Moving without a button pressed does nothing.
    stage().dispatchEvent(pointer("pointermove", 90, 90));
    await settle(fixture);
    expect(offset(image()).map(Math.round)).toEqual([Math.round(x2! + 30), Math.round(y2! + 20)]);
  });

  it("moves the picture with the arrow keys", async () => {
    const { image, load, press } = await open(diagram);
    await load();
    await press("ArrowLeft");
    await press("ArrowUp");
    expect(offset(image())).toEqual([24 + 48, 174 + 48]);
  });

  it("leaves Escape to the source's editor when it uses it, and keys typed there alone", async () => {
    const { element, button, fixture, load, level, press } = await open(diagram);
    await load();
    button("Split").click();
    await settle(fixture);
    const content = element.querySelector(".cm-content")!;
    await press("+", content);
    expect(level()).toBe("50 %");
    const closed = vi.fn();
    document.body.addEventListener("keydown", closed);
    content.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    await press("Escape", content);
    expect(closed).not.toHaveBeenCalled();
    await press("Escape", content);
    expect(closed).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("keydown", closed);
  });
});
