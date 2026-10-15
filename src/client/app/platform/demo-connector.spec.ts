import { connectPlatform } from "./connect.demo";
import { connectDemo, DOWNLOAD_URL, type DemoPage } from "./demo-connector";

function fakePage(search = "") {
  const listeners = new Map<string, EventListener>();
  const page = {
    location: { pathname: "/try/", search, hash: "#/changes", replace: vi.fn() },
    open: vi.fn(),
    document: { title: "" },
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
  };
  return { page, listeners, demo: connectDemo(page as unknown as DemoPage) };
}

describe("the demo connector", () => {
  it("runs the managers in the page, starting with the sample project", async () => {
    const { demo } = fakePage();
    const opened = await demo.managers.workspace.restore([]);
    expect(opened!.snapshot.settings.name).toBe("Pocket Weather");
    expect(await demo.managers.terminal.available()).toBe(false);
    expect(demo.shell.runtime).toBe("demo");
  });

  it("offers the experiment with real repositories only when the address asks for it", () => {
    expect(fakePage().demo.demo!.realRepositories).toBeUndefined();
    const { realRepositories } = fakePage("?real-repositories").demo.demo!;
    expect(realRepositories!.isClone({ kind: "local", path: "/demo/clone-github.com-genbeya-genbeya" })).toBe(true);
    expect(realRepositories!.isClone({ kind: "local", path: "/demo/pocket-weather" })).toBe(false);
  });

  it("is what the demo build connects to", async () => {
    expect((await connectPlatform()).shell.runtime).toBe("demo");
  });

  it("keeps layout choices in memory, not in the browser's storage", () => {
    const { demo } = fakePage();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    demo.storage!.setItem("width:sidebar", "300");
    expect(demo.storage!.getItem("width:sidebar")).toBe("300");
    expect(setItem).not.toHaveBeenCalled();
    expect(fakePage().demo.storage!.getItem("width:sidebar")).toBeNull();
  });

  it("starts over by loading the page again, at its start, without asking about edits", () => {
    const { page, listeners, demo } = fakePage();
    demo.shell.guardClose(() => true);
    const leave = new Event("beforeunload", { cancelable: true });
    listeners.get("beforeunload")!(leave);
    expect(leave.defaultPrevented).toBe(true);
    demo.demo!.reset();
    expect(page.location.replace).toHaveBeenCalledWith("/try/");
    const reset = new Event("beforeunload", { cancelable: true });
    listeners.get("beforeunload")!(reset);
    expect(reset.defaultPrevented).toBe(false);
    expect(demo.demo!.downloadUrl).toBe(DOWNLOAD_URL);
  });

  it("opens web links in a new tab, and nothing else", async () => {
    const { page, demo } = fakePage();
    await demo.shell.openExternal("https://genbeya.fyi/download");
    expect(page.open).toHaveBeenCalledWith("https://genbeya.fyi/download", "_blank", "noopener,noreferrer");
    await expect(demo.shell.openExternal("genbeya://open")).rejects.toThrow("Only web and mail links");
  });

  it("offers its folder for new samples, and explains that the visitor's folders are out of reach", async () => {
    const { demo } = fakePage();
    const folder = (await demo.shell.pickFolder())!;
    await expect(demo.managers.workspace.open(folder)).rejects.toThrow("can't open folders on your computer");
    expect((await demo.managers.workspace.createSample(folder)).snapshot.settings.name).toBe("Pocket Weather");
  });
});
