import { TestBed } from "@angular/core/testing";
import type { TerminalOutput } from "../../../../contracts/model";
import { isMac } from "../../core/hotkeys";
import { Terminals } from "../../core/terminals";
import { openRepository, settle } from "../../testing/component-harness";
import { TerminalPanel } from "./terminal-panel";
import { XTERM, type Xterm } from "./xterm";

/** Stands in for xterm.js, which needs a real layout engine. */
class FakeXterm {
  static created: FakeXterm[] = [];
  readonly cols = 100;
  readonly rows = 30;
  readonly options: Record<string, unknown>;
  readonly written: string[] = [];
  keys: (event: KeyboardEvent) => boolean = () => true;
  type: (data: string) => void = () => undefined;
  selection = false;

  constructor(options: Record<string, unknown>) {
    this.options = options;
    FakeXterm.created.push(this);
  }
  loadAddon = vi.fn();
  open = vi.fn();
  focus = vi.fn();
  dispose = vi.fn();
  onResize = vi.fn();
  hasSelection() {
    return this.selection;
  }
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) {
    this.keys = handler;
  }
  onData(listener: (data: string) => void) {
    this.type = listener;
  }
  write(data: string) {
    this.written.push(data);
  }
}

async function setup(available = true) {
  FakeXterm.created = [];
  const xterm = async () => ({ Terminal: FakeXterm, FitAddon: class {} }) as unknown as Xterm;
  const harness = await openRepository({}, [{ provide: XTERM, useValue: xterm }]);
  const { terminal } = harness.managers;
  terminal.available.mockResolvedValue(available);
  terminal.open.mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
  // The shell prints once, then waits.
  terminal.read.mockResolvedValueOnce({ data: "hello\r\n" }).mockImplementation(() => new Promise<TerminalOutput>(() => undefined));
  const terminals = TestBed.inject(Terminals);
  await terminals.show();
  const fixture = TestBed.createComponent(TerminalPanel);
  await settle(fixture);
  const element: HTMLElement = fixture.nativeElement;
  const button = (name: string) => element.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  return { ...harness, terminal, terminals, fixture, element, button };
}

describe("TerminalPanel", () => {
  it("starts the first terminal's shell in the open repository and shows its output", async () => {
    const { terminal, element } = await setup();
    expect(terminal.open).toHaveBeenCalledWith("w1", 100, 30);
    expect(element.querySelector('[role="tab"]')?.textContent).toContain("Terminal 1");
    expect(FakeXterm.created[0]!.written).toEqual(["hello\r\n"]);
    expect(FakeXterm.created[0]!.options["fontSize"]).toBe(13);
  });

  it("sends what the user types to the shell", async () => {
    const { terminal } = await setup();
    FakeXterm.created[0]!.type("ls\r");
    await settle();
    expect(terminal.write).toHaveBeenCalledWith("t1", "ls\r");
  });

  it("adds and closes terminals from its header", async () => {
    const { terminal, terminals, element, button, fixture } = await setup();
    button("New terminal").click();
    await settle(fixture);
    expect([...element.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).toEqual(["Terminal 1", "Terminal 2"]);
    expect(element.querySelectorAll("gd-terminal-view:not([hidden])")).toHaveLength(1);
    button("Close Terminal 1").click();
    await settle(fixture);
    expect(terminal.close).toHaveBeenCalledWith("t1");
    expect(terminals.tabs().map((tab) => tab.title)).toEqual(["Terminal 2"]);
  });

  it("hands its own shortcut, and copying and pasting, to the app", async () => {
    await setup();
    const xterm = FakeXterm.created[0]!;
    const key = (key: string, init: KeyboardEventInit = {}) => xterm.keys(new KeyboardEvent("keydown", { key, ...init }));
    const mod = isMac ? { metaKey: true } : { ctrlKey: true };
    expect(key("`", mod)).toBe(false);
    expect(key("a")).toBe(true);
    if (isMac) return;
    expect(key("c", { ctrlKey: true })).toBe(true);
    xterm.selection = true;
    expect(key("c", { ctrlKey: true })).toBe(false);
    expect(key("v", { ctrlKey: true })).toBe(false);
  });

  it("explains a build without terminals", async () => {
    const { element, terminal } = await setup(false);
    expect(element.textContent).toContain("The terminal is not available in this build.");
    expect(element.querySelector('[role="tab"]')).toBeNull();
    expect(terminal.open).not.toHaveBeenCalled();
  });
});
