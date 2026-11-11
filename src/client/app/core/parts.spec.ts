import { TestBed } from "@angular/core/testing";
import { openRepository } from "../testing/component-harness";
import { pull, SETTINGS, task } from "../testing/fake-platform";
import { Parts, usesPart } from "./parts";

const KEY = "local:/repo";

async function setup(unused: typeof SETTINGS.unused = []) {
  const harness = await openRepository({ settings: { ...SETTINGS, unused } });
  return { ...harness, parts: TestBed.inject(Parts) };
}

describe("Parts", () => {
  it("shows the parts every project has, and the others once the project uses them", async () => {
    const { parts } = await setup();
    expect(["wiki", "tasks", "code", "terminal"].every((part) => parts.isShown(part as never))).toBe(true);
    expect(["planning", "timelog", "pulls"].some((part) => parts.isShown(part as never))).toBe(false);
    expect(parts.home()).toBe("wiki");
    const snapshot = {
      settings: SETTINGS,
      tasks: [task("TP-1", { body: "## Time log\n\n- 2026-10-21 — Ada — 2h\n" })],
      pulls: [pull("PR-1")],
    };
    expect(["planning", "timelog", "pulls"].map((part) => usesPart(part as never, snapshot))).toEqual([true, true, true]);
    const fields = { ...SETTINGS, fields: [{ name: "estimate", type: "effort" as const }] };
    expect(usesPart("planning", { settings: fields, tasks: [], pulls: [] })).toBe(true);
  });

  it("leaves out what the project doesn't use, with the parts that need it", async () => {
    const { parts } = await setup(["wiki", "tasks"]);
    expect(["wiki", "tasks", "planning", "timelog"].map((part) => parts.isShown(part as never))).toEqual([false, false, false, false]);
    expect(parts.home()).toBe("code");
  });

  it("follows the user's choices, in every repository or in this one alone", async () => {
    const { parts, managers, session } = await setup();
    await parts.setShown("terminal", false, true);
    expect(managers.workspace.setPreferences).toHaveBeenLastCalledWith({ parts: { all: { terminal: false }, repositories: {} } });
    expect(parts.isShown("terminal")).toBe(false);
    expect(parts.ownChoice()).toBe(false);

    await parts.setOwnChoice(true);
    expect(session.preferences().parts).toEqual({ all: { terminal: false }, repositories: { [KEY]: { terminal: false } } });
    await parts.setShown("tasks", false, false);
    expect(parts.isShown("tasks")).toBe(false);
    // Showing the time log shows what it needs, planning and tasks.
    expect(parts.isAutomatic("timelog")).toBe(true);
    await parts.setShown("timelog", true, false);
    expect(session.preferences().parts.repositories[KEY]).toEqual({ terminal: false, tasks: true, timelog: true, planning: true });
    expect(["tasks", "planning", "timelog"].every((part) => parts.isShown(part as never))).toBe(true);
    expect(parts.isAutomatic("timelog")).toBe(false);

    await parts.setOwnChoice(false);
    expect(session.preferences().parts).toEqual({ all: { terminal: false }, repositories: {} });
  });
});
