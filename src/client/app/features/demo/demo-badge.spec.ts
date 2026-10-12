import { TestBed } from "@angular/core/testing";
import { Demo } from "../../core/demo";
import { settle } from "../../testing/component-harness";
import { providePlatform } from "../../testing/fake-platform";
import { DemoBadge } from "./demo-badge";

async function setup(active: boolean) {
  const demo = { active, reset: vi.fn(async () => undefined), download: vi.fn(async () => undefined) };
  TestBed.configureTestingModule({ providers: [...providePlatform(), { provide: Demo, useValue: demo }] });
  const fixture = TestBed.createComponent(DemoBadge);
  await settle(fixture);
  return { demo, fixture, element: fixture.nativeElement as HTMLElement };
}

/** The menu item with `label`, in the overlay the menu opens in. */
const item = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>(".cdk-overlay-container button")].find((button) => button.textContent?.includes(label))!;

describe("DemoBadge", () => {
  it("shows nothing in the app", async () => {
    const { element } = await setup(false);
    expect(element.textContent?.trim()).toBe("");
  });

  it("says it is the demo, and offers to start over or get the app", async () => {
    const { element, demo, fixture } = await setup(true);
    const badge = element.querySelector<HTMLButtonElement>(".demo-badge")!;
    expect(badge.textContent).toContain("Demo");
    badge.click();
    await settle(fixture);
    expect(document.querySelector(".cdk-overlay-container")?.textContent).toContain("Nothing you do is saved or sent anywhere");
    item("Reset demo").click();
    expect(demo.reset).toHaveBeenCalled();
    badge.click();
    await settle(fixture);
    item("Download Genbeya").click();
    expect(demo.download).toHaveBeenCalled();
  });
});
