import { Dialog } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import { Hotkeys, isMac, isTyping, matchesHotkey } from "./hotkeys";

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) => {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
};
const mod = isMac ? { metaKey: true } : { ctrlKey: true };

describe("Hotkeys", () => {
  let hotkeys: Hotkeys;
  const dialog = { openDialogs: [] as unknown[] };
  beforeEach(() => {
    dialog.openDialogs = [];
    TestBed.configureTestingModule({ providers: [{ provide: Dialog, useValue: dialog }] });
    hotkeys = TestBed.inject(Hotkeys);
  });

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

  it("matches symbols whatever Shift the layout needs for them", () => {
    // On Swiss and German layouts "/" is Shift+7.
    const filter = vi.fn();
    hotkeys.register("/", filter);
    press("/", { shiftKey: true });
    press("/");
    expect(filter).toHaveBeenCalledTimes(2);
  });

  it("matches the backquote key by position on layouts without it", () => {
    // Ctrl+` on a US layout is Ctrl+§ on a Swiss one, and a dead key on a German one.
    const toggle = vi.fn();
    hotkeys.register("mod+`", toggle);
    press("`", mod);
    press("§", { ...mod, code: "Backquote" });
    press("Dead", { ...mod, code: "Equal" });
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it("tells whether an event is a shortcut, for widgets that let some keys through", () => {
    const textarea = document.body.appendChild(document.createElement("textarea"));
    expect(matchesHotkey("mod+`", new KeyboardEvent("keydown", { key: "`", ...mod }))).toBe(true);
    expect(matchesHotkey("mod+`", new KeyboardEvent("keydown", { key: "`" }))).toBe(false);
    expect(isTyping(textarea)).toBe(true);
    textarea.remove();
  });

  it("stays out of the way of open dialogs and menus", () => {
    const palette = vi.fn();
    const edit = vi.fn();
    hotkeys.register("mod+k", palette);
    hotkeys.register("e", edit);
    dialog.openDialogs = [{}];
    press("k", mod);
    press("e");
    dialog.openDialogs = [];
    const overlay = document.body.appendChild(document.createElement("div"));
    overlay.className = "cdk-overlay-container";
    const item = overlay.appendChild(document.createElement("button"));
    press("e", {}, item);
    overlay.remove();
    expect(palette).not.toHaveBeenCalled();
    expect(edit).not.toHaveBeenCalled();
    press("e");
    expect(edit).toHaveBeenCalledTimes(1);
  });
});
