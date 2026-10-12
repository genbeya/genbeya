import { TestBed } from "@angular/core/testing";
import { DEMO } from "../platform/platform";
import { fakeShell, providePlatform } from "../testing/fake-platform";
import { Demo } from "./demo";
import { Dialogs } from "./dialogs";

function setup(demo: boolean, confirmed = true) {
  const controls = { reset: vi.fn(), downloadUrl: "https://genbeya.fyi/download" };
  const shell = fakeShell();
  const dialogs = { confirm: vi.fn(async () => confirmed) };
  TestBed.configureTestingModule({
    providers: [
      ...providePlatform(undefined, shell),
      { provide: Dialogs, useValue: dialogs },
      ...(demo ? [{ provide: DEMO, useValue: controls }] : []),
    ],
  });
  return { demo: TestBed.inject(Demo), controls, shell, dialogs };
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
});
