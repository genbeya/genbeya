import { TestBed } from "@angular/core/testing";
import { NavigationGuard } from "./navigation-guard";

const fire = (target: EventTarget, event: Event) => (target.dispatchEvent(event), event.defaultPrevented);

describe("NavigationGuard", () => {
  beforeEach(() => TestBed.inject(NavigationGuard));

  it("keeps dropped files from replacing the app", () => {
    expect(fire(document.body, new Event("dragover", { cancelable: true, bubbles: true }))).toBe(true);
    expect(fire(document.body, new Event("drop", { cancelable: true, bubbles: true }))).toBe(true);
  });

  it("keeps middle clicks on links from opening windows", () => {
    const link = document.body.appendChild(document.createElement("a"));
    link.href = "https://example.com";
    expect(fire(link, new MouseEvent("auxclick", { button: 1, cancelable: true, bubbles: true }))).toBe(true);
    expect(fire(document.body, new MouseEvent("auxclick", { button: 1, cancelable: true, bubbles: true }))).toBe(false);
    link.remove();
  });
});
