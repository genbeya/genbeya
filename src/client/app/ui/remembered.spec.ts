import { TestBed } from "@angular/core/testing";
import { LAYOUT_STORAGE, Remembered } from "./remembered";

describe("Remembered", () => {
  it("keeps choices in the page's local storage", () => {
    TestBed.inject(Remembered).remember("layout:test", "list");
    expect(localStorage.getItem("layout:test")).toBe("list");
    expect(TestBed.inject(Remembered).recall("layout:test")).toBe("list");
  });

  it("keeps them where the platform says instead", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    TestBed.configureTestingModule({ providers: [{ provide: LAYOUT_STORAGE, useValue: storage }] });
    TestBed.inject(Remembered).remember("layout:elsewhere", "board");
    expect(values.get("layout:elsewhere")).toBe("board");
    expect(localStorage.getItem("layout:elsewhere")).toBeNull();
  });

  it("falls back to the default when storage fails or is missing", () => {
    const failing = {
      getItem: () => {
        throw new Error("Blocked.");
      },
      setItem: () => {
        throw new Error("Full.");
      },
    };
    TestBed.configureTestingModule({ providers: [{ provide: LAYOUT_STORAGE, useValue: failing }] });
    const remembered = TestBed.inject(Remembered);
    expect(remembered.recall("x")).toBeNull();
    expect(() => remembered.remember("x", "y")).not.toThrow();
  });
});
