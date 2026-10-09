import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { nodeMachine } from "../../platforms/node/node-machine";
import { temporaryFolder } from "../../testing/temp";
import { DEFAULT_PREFERENCES, PreferencesStore } from "./preferences-store";

const machine = nodeMachine();
const a = { kind: "local", path: "/a" } as const;
const b = { kind: "wsl", distro: "Ubuntu", path: "/a" } as const;

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

  it("ignores unreadable files and fills in new preferences", async () => {
    const folder = await temporaryFolder("prefs-");
    await fs.writeFile(path.join(folder, "state.json"), "{ broken");
    expect((await PreferencesStore.load(machine, folder)).recent).toEqual([]);
    await fs.writeFile(path.join(folder, "state.json"), JSON.stringify({ preferences: { theme: "light" } }));
    expect((await PreferencesStore.load(machine, folder)).preferences).toEqual({ ...DEFAULT_PREFERENCES, theme: "light" });
  });
});
