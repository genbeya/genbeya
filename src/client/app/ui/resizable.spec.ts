import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Resizable, ResizeHandle } from "./resizable";

/** A bottom panel that CSS keeps at most 400px tall, like the terminal panel in a short window. */
@Component({
  imports: [Resizable, ResizeHandle],
  template: `
    <section gdResizable="test-panel" edge="top" [initial]="280" [min]="120" [max]="1200" #panel="gdResizable">
      <div [gdResizeHandle]="panel"></div>
    </section>
  `,
})
class Panel {}

const CSS_MAX = 400;

async function render(stored?: number) {
  if (stored) localStorage.setItem("height:test-panel", String(stored));
  const fixture = TestBed.createComponent(Panel);
  await fixture.whenStable();
  const section: HTMLElement = fixture.nativeElement.querySelector("section");
  // jsdom has no layout: the panel renders as tall as its style says, up to the CSS maximum.
  Object.defineProperty(section, "offsetHeight", { get: () => Math.min(parseFloat(section.style.height) || 0, CSS_MAX) });
  const handle = section.querySelector<HTMLElement>(".resizer")!;
  const pointer = (type: string, clientY: number, target: EventTarget = window) =>
    target.dispatchEvent(new MouseEvent(type, { clientY, bubbles: true, cancelable: true }));
  /** Drags the top edge from y 500 to `to`, returning the size while dragging and the one remembered. */
  const drag = async (to: number) => {
    pointer("pointerdown", 500, handle);
    pointer("pointermove", to);
    await fixture.whenStable();
    const during = parseFloat(section.style.height);
    pointer("pointerup", to);
    await fixture.whenStable();
    return { during, remembered: Number(localStorage.getItem("height:test-panel")) };
  };
  return { drag };
}

describe("Resizable", () => {
  afterEach(() => localStorage.removeItem("height:test-panel"));

  it("follows the pointer within its limits", async () => {
    const { drag } = await render();
    expect(await drag(400)).toEqual({ during: 380, remembered: 380 });
    expect(await drag(900)).toEqual({ during: 120, remembered: 120 });
  });

  it("grows no further than the layout lets it", async () => {
    const { drag } = await render();
    expect(await drag(0)).toEqual({ during: CSS_MAX, remembered: CSS_MAX });
  });

  it("starts a drag from the size it shows, so the edge follows the pointer at once", async () => {
    // Remembered from a taller window.
    const { drag } = await render(1000);
    expect(await drag(550)).toEqual({ during: CSS_MAX - 50, remembered: CSS_MAX - 50 });
  });
});
