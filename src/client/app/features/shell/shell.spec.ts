import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Notifications } from "../../core/notifications";
import { Terminals } from "../../core/terminals";
import { openRepository, settle } from "../../testing/component-harness";
import { Shell, TERMINAL_PANEL } from "./shell";

@Component({ selector: "gd-terminal-panel", template: "" })
class PanelStub {
  static created = 0;
  constructor() {
    PanelStub.created++;
  }
}

async function setup() {
  PanelStub.created = 0;
  const load = vi.fn<() => Promise<typeof PanelStub>>();
  const harness = await openRepository({}, [{ provide: TERMINAL_PANEL, useValue: load }]);
  vi.spyOn(harness.router, "navigate").mockResolvedValue(true);
  const fixture = TestBed.createComponent(Shell);
  await settle(fixture);
  return { ...harness, fixture, load, terminals: TestBed.inject(Terminals), notifications: TestBed.inject(Notifications) };
}

describe("Shell", () => {
  it("loads the terminal panel when a terminal is first wanted, and tries again after a failed load", async () => {
    const { fixture, load, terminals, notifications } = await setup();
    expect(load).not.toHaveBeenCalled();
    load.mockRejectedValueOnce(new Error("Failed to fetch dynamically imported module")).mockResolvedValueOnce(PanelStub);
    terminals.shown.set(true);
    await settle(fixture);
    expect(notifications.visible().map((notification) => notification.message)).toEqual([
      "The terminal could not load: Failed to fetch dynamically imported module",
    ]);
    expect(terminals.shown()).toBe(false);

    terminals.shown.set(true);
    await settle(fixture);
    expect(load).toHaveBeenCalledTimes(2);
    expect(PanelStub.created).toBe(1);
    expect(fixture.nativeElement.querySelector("gd-terminal-panel")).not.toBeNull();
  });

  it("adds no panel to a shell that closed while the panel loaded", async () => {
    const { fixture, load, terminals } = await setup();
    let loaded!: (panel: typeof PanelStub) => void;
    load.mockReturnValue(new Promise((resolve) => (loaded = resolve)));
    terminals.shown.set(true);
    await settle(fixture);
    fixture.destroy();
    loaded(PanelStub);
    await settle();
    expect(PanelStub.created).toBe(0);
  });
});
