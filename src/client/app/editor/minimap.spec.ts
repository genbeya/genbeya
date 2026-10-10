import { Text } from "@codemirror/state";
import { drawnRanges, minimapLayout } from "./minimap";

describe("minimap layout", () => {
  it("shows a short file whole, with the visible lines marked", () => {
    // 100 lines at three pixels each fit into 400 pixels; lines 11 to 40 are visible.
    expect(minimapLayout(100, 400, 0.2, 11, 40)).toEqual({ offset: 0, first: 1, sliderTop: 30, sliderHeight: 90, track: 210 });
  });

  it("scrolls a long file's map along with the editor", () => {
    // 1000 lines need 3000 pixels; halfway down, the map is scrolled by half of the 2600 that do not fit.
    const layout = minimapLayout(1000, 400, 0.5, 481, 520);
    expect(layout).toMatchObject({ offset: 1300, first: 434, sliderTop: 140, sliderHeight: 120, track: 280 });
  });

  it("keeps the slider big enough to grab", () => {
    expect(minimapLayout(10, 400, 0, 1, 1).sliderHeight).toBe(12);
  });
});

describe("minimap drawing", () => {
  it("highlights each drawn line only up to the columns the map has", () => {
    const doc = Text.of(["short", "x".repeat(10_000), "", "end"]);
    expect(drawnRanges(doc, 2, 4)).toEqual([
      { from: 6, to: 6 + 64 },
      { from: 10_007, to: 10_007 },
      { from: 10_008, to: 10_011 },
    ]);
  });
});
