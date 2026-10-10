import { ApplicationRef } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { Diagrams } from "../../markdown/diagrams";
import { providePlatform } from "../../testing/fake-platform";
import { Tour, type TourStep } from "./tour";

const step = (name: string, change: Partial<TourStep> = {}): TourStep => ({
  target: `[data-tour="${name}"]`,
  title: `About ${name}`,
  body: `The **${name}** element.`,
  ...change,
});

const placed: HTMLElement[] = [];

/** Puts elements on the page for steps to point at. */
function place(...names: string[]) {
  for (const name of names) {
    const element = document.createElement("button");
    element.dataset["tour"] = name;
    element.textContent = name;
    document.body.append(element);
    placed.push(element);
  }
}

const popover = () => document.querySelector<HTMLElement>(".tour-popover");
const button = (name: string) => [...popover()!.querySelectorAll("button")].find((element) => element.textContent?.trim() === name)!;

/** Renders the layer, then waits until the popover shows `count` ("2 of 3"). The first wait loads the layer's chunk. */
async function showing(count: string) {
  await vi.waitFor(
    () => {
      TestBed.inject(ApplicationRef).tick();
      expect(popover()?.querySelector(".tour-count")?.textContent).toBe(count);
    },
    { timeout: 10_000 },
  );
}

describe("Tour", () => {
  let tour: Tour;

  beforeEach(() => {
    // jsdom lays nothing out; elements on the page count as visible.
    vi.spyOn(Element.prototype, "getClientRects").mockImplementation(function (this: Element) {
      return (this.isConnected ? [new DOMRect(10, 10, 80, 20)] : []) as unknown as DOMRectList;
    });
    TestBed.configureTestingModule({ providers: [...providePlatform(), provideRouter([]), { provide: Diagrams, useValue: {} }] });
    tour = TestBed.inject(Tour);
  });

  afterEach(() => {
    tour.stop();
    for (const element of placed.splice(0)) element.remove();
    vi.restoreAllMocks();
  });

  it("walks forward and back through the steps, then completes", async () => {
    place("one", "two", "three");
    const ended = tour.start([step("one"), step("two", { tryIt: "Click it" }), step("three")]);
    await showing("1 of 3");
    expect(popover()!.getAttribute("role")).toBe("dialog");
    expect(popover()!.querySelector("h2")!.textContent).toBe("About one");
    expect(popover()!.querySelector(".tour-body strong")!.textContent).toBe("one");
    expect(button("Back")).toBeUndefined();

    button("Next").click();
    await showing("2 of 3");
    expect(popover()!.querySelector(".tour-try")!.textContent).toContain("Click it");
    button("Back").click();
    await showing("1 of 3");
    button("Next").click();
    await showing("2 of 3");
    button("Next").click();
    await showing("3 of 3");
    button("Done").click();

    expect(await ended).toBe("completed");
    expect(popover()).toBeNull();
    expect(document.querySelector("gd-tour-layer")).toBeNull();
  });

  it("skips steps whose element is not there, in both directions", async () => {
    place("one", "three");
    void tour.start([step("one"), step("two"), step("three")]);
    await showing("1 of 3");
    button("Next").click();
    await showing("3 of 3");
    button("Back").click();
    await showing("1 of 3");
  });

  it("completes at once when no step's element is there", async () => {
    expect(await tour.start([step("missing")])).toBe("completed");
  });

  it("goes to a step's route before looking for its element", async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), "navigateByUrl").mockImplementation(async () => {
      place("routed");
      return true;
    });
    void tour.start([step("routed", { route: "/tasks" })]);
    await showing("1 of 1");
    expect(navigate).toHaveBeenCalledWith("/tasks");
  });

  it("stays on a route that is shown already, whatever its view shows", async () => {
    const router = TestBed.inject(Router);
    router.resetConfig([{ path: "tasks", children: [] }]);
    await router.navigateByUrl("/tasks?task=TP-1");
    const navigate = vi.spyOn(router, "navigateByUrl");
    place("routed");
    void tour.start([step("routed", { route: "/tasks" })]);
    await showing("1 of 1");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("is driven by the keyboard and moves the focus along", async () => {
    place("one", "two");
    const field = document.createElement("input");
    document.body.append(field);
    placed.push(field);
    field.focus();
    const ended = tour.start([step("one"), step("two")]);
    await showing("1 of 2");
    await vi.waitFor(() => expect(document.activeElement).toBe(button("Next")));

    popover()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await showing("2 of 2");
    popover()!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    await showing("1 of 2");

    // Escape in a field belongs to the field.
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(tour.current()).not.toBeNull();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(await ended).toBe("ended");
    expect(document.activeElement).toBe(field);
  });

  it("ends a running tour when another starts", async () => {
    place("one");
    const first = tour.start([step("one")]);
    await showing("1 of 1");
    void tour.start([step("one"), step("one")]);
    expect(await first).toBe("ended");
    await showing("1 of 2");
  });
});
