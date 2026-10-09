import { describe, expect, it } from "vitest";
import { placeOnScreen } from "./window-state";

const screen = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1280, height: 1000 };

describe("placeOnScreen", () => {
  it("keeps a window that is on a screen", () => {
    expect(placeOnScreen({ x: 100, y: 50, width: 1200, height: 800, maximized: false }, [screen, second])).toEqual({
      x: 100,
      y: 50,
      width: 1200,
      height: 800,
      maximized: false,
    });
  });

  it("forgets the position when the title bar would be out of reach", () => {
    // Only the window's bottom edge overlaps the screen.
    expect(placeOnScreen({ x: 100, y: -790, width: 1200, height: 800, maximized: false }, [screen])).toBeNull();
    // The screen it was on is gone.
    expect(placeOnScreen({ x: 2000, y: 50, width: 1000, height: 800, maximized: true }, [screen])).toBeNull();
  });

  it("shrinks a window larger than its screen", () => {
    expect(placeOnScreen({ x: 1950, y: 10, width: 2400, height: 1400, maximized: false }, [screen, second])).toEqual({
      x: 1920,
      y: 0,
      width: 1280,
      height: 1000,
      maximized: false,
    });
  });
});
