import { TestBed } from "@angular/core/testing";
import { Hotkeys, isMac } from "./hotkeys";

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
const mod = isMac ? { metaKey: true } : { ctrlKey: true };

describe("Hotkeys", () => {
  let hotkeys: Hotkeys;
  beforeEach(() => (hotkeys = TestBed.inject(Hotkeys)));

  it("runs the handler for its combination and prevents the default", () => {
    const save = vi.fn();
    const stop = hotkeys.register("mod+s", save);
    expect(press("s", mod).defaultPrevented).toBe(true);
    expect(press("s").defaultPrevented).toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
    stop();
    press("s", mod);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("lets the newest registration win", () => {
    const page = vi.fn();
    const panel = vi.fn();
    hotkeys.register("escape", page);
    const close = hotkeys.register("escape", panel);
    press("Escape");
    close();
    press("Escape");
    expect(panel).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);
  });

  it("ignores single keys while typing, but not Escape or modified keys", () => {
    const edit = vi.fn();
    const escape = vi.fn();
    const search = vi.fn();
    hotkeys.register("e", edit);
    hotkeys.register("escape", escape);
    hotkeys.register("mod+k", search);
    const input = document.body.appendChild(document.createElement("input"));
    press("e", {}, input);
    press("Escape", {}, input);
    press("k", mod, input);
    input.remove();
    expect(edit).not.toHaveBeenCalled();
    expect(escape).toHaveBeenCalled();
    expect(search).toHaveBeenCalled();
  });

  it("skips disabled registrations", () => {
    const handler = vi.fn();
    let enabled = false;
    hotkeys.register("c", handler, () => enabled);
    press("c");
    enabled = true;
    press("c");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("matches question marks typed with Shift", () => {
    const help = vi.fn();
    hotkeys.register("?", help);
    press("?", { shiftKey: true });
    expect(help).toHaveBeenCalled();
  });
});
