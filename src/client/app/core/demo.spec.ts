import { TestBed } from "@angular/core/testing";
import { DEMO, type DemoAbout, type DemoAction } from "../platform/platform";
import { fakeShell, providePlatform } from "../testing/fake-platform";
import { Demo } from "./demo";
import { Dialogs } from "./dialogs";
import { Notifications } from "./notifications";

function setup(demo: boolean, confirmed = true, about?: DemoAbout) {
  const controls = { reset: vi.fn(), downloadUrl: "https://genbeya.fyi/download", ...(about ? { about: () => about } : {}) };
  const shell = fakeShell();
  const dialogs = { confirm: vi.fn(async () => confirmed) };
  const notifications = { success: vi.fn(), error: vi.fn() };
  TestBed.configureTestingModule({
    providers: [
      ...providePlatform(undefined, shell),
      { provide: Dialogs, useValue: dialogs },
      { provide: Notifications, useValue: notifications },
      ...(demo ? [{ provide: DEMO, useValue: controls }] : []),
    ],
  });
  return { demo: TestBed.inject(Demo), controls, shell, dialogs, notifications };
}

describe("Demo", () => {
  it("is off in the app", () => {
    expect(setup(false).demo.active).toBe(false);
  });

  it("starts over once the visitor confirms", async () => {
    const { demo, controls, dialogs } = setup(true);
    expect(demo.active).toBe(true);
    await demo.reset();
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Reset the demo?", confirm: "Reset demo" }));
    expect(controls.reset).toHaveBeenCalled();
  });

  it("keeps everything when the visitor declines", async () => {
    const { demo, controls } = setup(true, false);
    await demo.reset();
    expect(controls.reset).not.toHaveBeenCalled();
  });

  it("opens the download page", async () => {
    const { demo, shell } = setup(true);
    await demo.download();
    expect(shell.openExternal).toHaveBeenCalledWith("https://genbeya.fyi/download");
  });

  it("asks and links in the words of the page it runs on", async () => {
    const about: DemoAbout = {
      title: "About this page",
      pill: "GitHub",
      caption: "acme/rockets",
      note: "On GitHub.",
      reset: { label: "Read again from GitHub", title: "Read acme/rockets again?", message: "Everything you changed goes." },
      link: { label: "Open on GitHub", url: "https://github.com/acme/rockets" },
    };
    const { demo, dialogs, shell } = setup(true, true, about);
    expect(demo.about).toBe(about);
    await demo.reset();
    expect(dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Read acme/rockets again?",
        message: "Everything you changed goes.",
        confirm: "Read again from GitHub",
      }),
    );
    await demo.openLink();
    expect(shell.openExternal).toHaveBeenCalledWith("https://github.com/acme/rockets");
  });

  it("runs a choice of the page once the visitor confirms it, and says how it went", async () => {
    const { demo, dialogs, notifications } = setup(true);
    const run = vi.fn(async () => "Kept in this browser.");
    const keep: DemoAction = {
      label: "Keep",
      icon: "archive-restore",
      confirm: { title: "Keep it?", message: "Kept here.", label: "Keep it" },
      run,
    };
    await demo.run(keep);
    expect(dialogs.confirm).toHaveBeenCalledWith({ title: "Keep it?", message: "Kept here.", confirm: "Keep it", danger: false });
    expect(notifications.success).toHaveBeenCalledWith("Kept in this browser.");

    const failing: DemoAction = { label: "Fail", icon: "trash-2", run: () => Promise.reject(new Error("Disk full.")) };
    await demo.run(failing);
    expect(notifications.error).toHaveBeenCalledWith(new Error("Disk full."));
  });

  it("does nothing when the visitor declines a choice", async () => {
    const { demo } = setup(true, false);
    const run = vi.fn();
    await demo.run({ label: "Keep", icon: "archive-restore", confirm: { title: "Keep it?", message: "", label: "Keep it" }, run });
    expect(run).not.toHaveBeenCalled();
  });
});
