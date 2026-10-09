import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { temporaryFolder } from "../../testing/temp";
import { FileSystemError, type FileSystem, type Machine } from "../ports";
import { DEFAULT_PREFERENCES, PreferencesStore } from "./preferences-store";

const machine = nodeMachine();
const a = { kind: "local", path: "/a" } as const;
const b = { kind: "wsl", distro: "Ubuntu", path: "/a" } as const;

/** The node machine with a file system whose writes fail while `failing` is set. */
function flakyMachine() {
  const state = { failing: true };
  const fileSystem: FileSystem = {
    ...machine.fileSystem,
    writeFile: (path, data, exclusive) =>
      state.failing
        ? Promise.reject(new FileSystemError("EACCES", "Disk is read-only."))
        : machine.fileSystem.writeFile(path, data, exclusive),
  };
  return { state, machine: { ...machine, fileSystem } as Machine };
}

describe("PreferencesStore", () => {
  it("starts fresh without a file and persists changes", async () => {
    const folder = path.join(await temporaryFolder("prefs-"), "nested");
    const store = await PreferencesStore.load(machine, folder);
    expect(store.recent).toEqual([]);
    expect(store.preferences).toEqual(DEFAULT_PREFERENCES);
    store.remember(a, "A", 1);
    store.remember(b, "B", 2);
    store.remember(a, "A again", 3);
    store.setPreferences({ ...DEFAULT_PREFERENCES, theme: "dark" });
    await store.flush();

    const reloaded = await PreferencesStore.load(machine, folder);
    expect(reloaded.recent.map((entry) => entry.name)).toEqual(["A again", "B"]);
    expect(reloaded.preferences.theme).toBe("dark");
    reloaded.forget(b);
    expect(reloaded.recent.map((entry) => entry.name)).toEqual(["A again"]);
  });

  it("keeps at most twenty recent repositories", async () => {
    const store = await PreferencesStore.load(machine, await temporaryFolder("prefs-"));
    for (let i = 0; i < 25; i++) store.remember({ kind: "local", path: `/r${i}` }, `R${i}`);
    expect(store.recent).toHaveLength(20);
    expect(store.recent[0]!.name).toBe("R24");
    await store.flush();
  });

  it("survives a failing background save and retries on the next flush", async () => {
    const folder = await temporaryFolder("prefs-");
    const { state, machine: flaky } = flakyMachine();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      const store = await PreferencesStore.load(flaky, folder);
      store.remember(a, "A", 1);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(unhandled).not.toHaveBeenCalled();
      state.failing = false;
      await store.flush();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
    expect((await PreferencesStore.load(machine, folder)).recent.map((entry) => entry.name)).toEqual(["A"]);
  });

  it("replaces the file in one step, through a temporary file", async () => {
    const folder = await temporaryFolder("prefs-");
    const rename = vi.spyOn(machine.fileSystem, "rename");
    const writeFile = vi.spyOn(machine.fileSystem, "writeFile");
    onTestFinished(() => void vi.restoreAllMocks());
    const store = await PreferencesStore.load(machine, folder);
    store.remember(a, "A", 1);
    await store.flush();
    store.remember(b, "B", 2);
    await store.flush();
    const file = path.join(folder, "state.json");
    expect(writeFile).toHaveBeenLastCalledWith(`${file}.tmp`, expect.anything(), false);
    expect(rename).toHaveBeenLastCalledWith(`${file}.tmp`, file);
    expect(await fs.readdir(folder)).toEqual(["state.json"]);
    expect((await PreferencesStore.load(machine, folder)).recent.map((entry) => entry.name)).toEqual(["B", "A"]);
  });

  it("ignores unreadable files and fills in new preferences", async () => {
    const folder = await temporaryFolder("prefs-");
    await fs.writeFile(path.join(folder, "state.json"), "{ broken");
    expect((await PreferencesStore.load(machine, folder)).recent).toEqual([]);
    await fs.writeFile(path.join(folder, "state.json"), JSON.stringify({ preferences: { theme: "light" } }));
    expect((await PreferencesStore.load(machine, folder)).preferences).toEqual({ ...DEFAULT_PREFERENCES, theme: "light" });
  });
});
