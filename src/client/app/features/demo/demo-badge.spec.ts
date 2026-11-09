import { TestBed } from "@angular/core/testing";
import { Demo, DEMO_ABOUT, type DemoAbout, type DemoAction } from "../../core/demo";
import { settle } from "../../testing/component-harness";
import { providePlatform } from "../../testing/fake-platform";
import { DemoBadge } from "./demo-badge";

async function setup(active: boolean, about: DemoAbout = DEMO_ABOUT, actions: readonly DemoAction[] = []) {
  const demo = {
    active,
    about,
    actions: () => actions,
    run: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    download: vi.fn(async () => undefined),
    openLink: vi.fn(async () => undefined),
  };
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

  it("says what another page runs on, and links to it", async () => {
    const { element, demo, fixture } = await setup(true, {
      title: "About this page",
      pill: "GitHub",
      caption: "acme/rockets",
      note: "Genbeya runs here in your browser, on acme/rockets as it is on GitHub.",
      reset: { label: "Read again from GitHub", title: "Read acme/rockets again?", message: "Everything you changed goes." },
      link: { label: "Open on GitHub", url: "https://github.com/acme/rockets" },
    });
    const badge = element.querySelector<HTMLButtonElement>(".demo-badge")!;
    expect(badge.textContent).toContain("GitHub");
    expect(badge.textContent).toContain("acme/rockets");
    expect(badge.title).toBe("About this page");
    badge.click();
    await settle(fixture);
    expect(document.querySelector(".cdk-overlay-container")?.textContent).toContain("as it is on GitHub");
    item("Open on GitHub").click();
    expect(demo.openLink).toHaveBeenCalled();
    badge.click();
    await settle(fixture);
    item("Read again from GitHub").click();
    expect(demo.reset).toHaveBeenCalled();
  });

  it("offers the page's own choices", async () => {
    const keep: DemoAction = { label: "Keep in this browser", icon: "archive-restore", run: () => undefined };
    const { element, demo, fixture } = await setup(true, DEMO_ABOUT, [keep]);
    element.querySelector<HTMLButtonElement>(".demo-badge")!.click();
    await settle(fixture);
    item("Keep in this browser").click();
    expect(demo.run).toHaveBeenCalledWith(keep);
  });
});
