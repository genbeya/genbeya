import { TestBed } from "@angular/core/testing";
import { Clipboard } from "./clipboard";
import { Notifications } from "./notifications";

describe("Clipboard", () => {
  const writeText = vi.fn();
  beforeEach(() => {
    writeText.mockReset();
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  });

  it("copies and says so", async () => {
    writeText.mockResolvedValue(undefined);
    expect(await TestBed.inject(Clipboard).copy("abc", "Path")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
    expect(TestBed.inject(Notifications).visible()[0]).toMatchObject({ kind: "success", message: "Path copied" });
  });

  it("reports a clipboard that refuses instead of claiming success", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    expect(await TestBed.inject(Clipboard).copy("abc", "Path")).toBe(false);
    expect(TestBed.inject(Notifications).visible()[0]).toMatchObject({ kind: "error", message: "Couldn't copy to the clipboard." });
  });
});
