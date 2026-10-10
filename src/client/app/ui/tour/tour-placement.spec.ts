import { GAP, MARGIN, placePopover } from "./tour-placement";

const viewport = { width: 1000, height: 700 };
const popover = { width: 300, height: 160 };

describe("placePopover", () => {
  it("goes below the element, centred on it, when there is room", () => {
    expect(placePopover({ left: 400, top: 100, width: 200, height: 40 }, popover, viewport)).toEqual({
      left: 350,
      top: 140 + GAP,
      placement: "bottom",
    });
  });

  it("takes the preferred side when it fits", () => {
    expect(placePopover({ left: 400, top: 300, width: 200, height: 40 }, popover, viewport, "top")).toEqual({
      left: 350,
      top: 300 - GAP - 160,
      placement: "top",
    });
  });

  it("moves to a side with room", () => {
    // A tall sidebar entry at the left edge: no room above or below, so to its right.
    const placed = placePopover({ left: 0, top: 0, width: 236, height: 650 }, popover, viewport, "bottom");
    expect(placed).toMatchObject({ left: 236 + GAP, placement: "right" });
  });

  it("stays inside the window", () => {
    const placed = placePopover({ left: 900, top: 20, width: 90, height: 30 }, popover, viewport);
    expect(placed.placement).toBe("bottom");
    expect(placed.left).toBe(viewport.width - popover.width - MARGIN);
    const nearTop = placePopover({ left: 300, top: 0, width: 600, height: 20 }, popover, viewport, "top");
    expect(nearTop.placement).toBe("bottom");
  });

  it("overlaps an element that leaves no room on any side, on the side with the most room", () => {
    const placed = placePopover({ left: 240, top: 50, width: 740, height: 640 }, popover, viewport);
    expect(placed.placement).toBe("left");
    expect(placed.left).toBe(MARGIN);
  });

  it("centres itself without an element", () => {
    expect(placePopover(null, popover, viewport)).toEqual({ left: 350, top: 270, placement: "center" });
  });
});
