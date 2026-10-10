import { TestBed } from "@angular/core/testing";
import type { TerminalOutput } from "../../../contracts/model";
import { openRepository, settle } from "../testing/component-harness";
import { Terminals, type TerminalScreen } from "./terminals";

/** Reads that the test answers one by one, as the shell prints. */
function shellOutput(read: ReturnType<typeof vi.fn>) {
  const replies: ((output: TerminalOutput) => void)[] = [];
  read.mockImplementation(() => new Promise<TerminalOutput>((resolve) => replies.push(resolve)));
  return {
    print: async (output: TerminalOutput) => {
      await vi.waitFor(() => expect(replies.length).toBeGreaterThan(0));
      replies.shift()!(output);
      await settle();
    },
  };
}

const screen = () => ({ write: vi.fn<TerminalScreen["write"]>(), end: vi.fn<TerminalScreen["end"]>() });

async function setup(available = true) {
  const harness = await openRepository();
  const { terminal } = harness.managers;
  terminal.available.mockResolvedValue(available);
  terminal.open.mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
  const terminals = TestBed.inject(Terminals);
  return { ...harness, terminal, terminals };
}

describe("Terminals", () => {
  it("opens the panel with a first terminal, and hides it again", async () => {
    const { terminals } = await setup();
    await terminals.toggle();
    expect(terminals.shown()).toBe(true);
    expect(terminals.available()).toBe(true);
    expect(terminals.tabs().map((tab) => tab.title)).toEqual(["Terminal 1"]);
    await terminals.toggle();
    expect(terminals.shown()).toBe(false);
    await terminals.toggle();
    expect(terminals.tabs()).toHaveLength(1);
  });

  it("opens no terminal where the build has none", async () => {
    const { terminals } = await setup(false);
    await terminals.toggle();
    expect(terminals.shown()).toBe(true);
    expect(terminals.available()).toBe(false);
    expect(terminals.tabs()).toEqual([]);
  });

  it("starts a tab's shell in the open repository and streams its output to the screen", async () => {
    const { terminals, terminal } = await setup();
    const output = shellOutput(terminal.read);
    await terminals.toggle();
    const key = terminals.active()!;
    const view = screen();
    await terminals.connect(key, 100, 30, view);
    expect(terminal.open).toHaveBeenCalledWith("w1", 100, 30);
    await output.print({ data: "$ " });
    await output.print({ data: "" });
    await output.print({ data: "ls\r\n" });
    expect(view.write.mock.calls).toEqual([["$ "], ["ls\r\n"]]);
    expect(terminal.read).toHaveBeenCalledWith("t1");
  });

  it("sends typing in order, batching what piles up while a write is under way", async () => {
    const { terminals, terminal } = await setup();
    shellOutput(terminal.read);
    let finish!: () => void;
    terminal.write.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    await terminals.toggle();
    const key = terminals.active()!;
    await terminals.connect(key, 80, 24, screen());
    terminals.write(key, "l");
    terminals.write(key, "s");
    terminals.write(key, "\r");
    finish();
    await settle();
    expect(terminal.write.mock.calls).toEqual([
      ["t1", "l"],
      ["t1", "s\r"],
    ]);
    terminals.resize(key, 120, 40);
    expect(terminal.resize).toHaveBeenCalledWith("t1", 120, 40);
  });

  it("closes a tab whose shell exited normally, and explains other ends", async () => {
    const { terminals, terminal } = await setup();
    const output = shellOutput(terminal.read);
    await terminals.toggle();
    const first = terminals.active()!;
    terminals.add();
    const second = terminals.active()!;
    const firstScreen = screen();
    const secondScreen = screen();
    await terminals.connect(first, 80, 24, firstScreen);
    await terminals.connect(second, 80, 24, secondScreen);
    await output.print({ exit: 0 });
    expect(terminals.tabs().map((tab) => tab.key)).toEqual([second]);
    expect(terminals.active()).toBe(second);
    await output.print({ exit: 2 });
    expect(secondScreen.end).toHaveBeenCalledWith("The shell exited with code 2.");
    expect(terminals.tabs()).toHaveLength(1);
  });

  it("shows why a shell could not start", async () => {
    const { terminals, terminal } = await setup();
    terminal.open.mockReset().mockRejectedValue(new Error("ssh was not found. Install it and add it to PATH."));
    await terminals.toggle();
    const view = screen();
    await terminals.connect(terminals.active()!, 80, 24, view);
    expect(view.end).toHaveBeenCalledWith("ssh was not found. Install it and add it to PATH.");
  });

  it("ends the shell when its tab closes, and hides the panel with the last tab", async () => {
    const { terminals, terminal } = await setup();
    shellOutput(terminal.read);
    await terminals.toggle();
    const key = terminals.active()!;
    await terminals.connect(key, 80, 24, screen());
    terminals.close(key);
    expect(terminal.close).toHaveBeenCalledWith("t1");
    expect(terminals.tabs()).toEqual([]);
    expect(terminals.shown()).toBe(false);
  });

  it("ends every shell at once, as when the repository closes", async () => {
    const { terminals, terminal } = await setup();
    shellOutput(terminal.read);
    await terminals.toggle();
    await terminals.connect(terminals.active()!, 80, 24, screen());
    terminals.add();
    terminals.closeAll();
    expect(terminals.tabs()).toEqual([]);
    expect(terminals.shown()).toBe(false);
    expect(terminal.close).toHaveBeenCalledWith("t1");
  });

  it("ends a shell whose tab closed while it started", async () => {
    const { terminals, terminal } = await setup();
    await terminals.toggle();
    const key = terminals.active()!;
    const connecting = terminals.connect(key, 80, 24, screen());
    terminals.close(key);
    await connecting;
    expect(terminal.close).toHaveBeenCalledWith("t1");
    expect(terminal.read).not.toHaveBeenCalled();
  });
});
