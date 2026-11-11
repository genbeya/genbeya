import { TestBed } from "@angular/core/testing";
import { openRepository } from "../testing/component-harness";
import { SETTINGS } from "../testing/fake-platform";
import { Parts } from "./parts";

const KEY = "local:/repo";

async function setup(unused: typeof SETTINGS.unused = []) {
  const harness = await openRepository({ settings: { ...SETTINGS, unused } });
  return { ...harness, parts: TestBed.inject(Parts) };
}

describe("Parts", () => {
  it("shows everything until the project or the user leaves something out", async () => {
    const { parts } = await setup();
    expect(parts.isShown("wiki")).toBe(true);
    expect(parts.home()).toBe("wiki");
  });

  it("leaves out what the project doesn't use, with the parts that need it", async () => {
    const { parts } = await setup(["wiki", "tasks"]);
    expect(["wiki", "tasks", "planning", "timelog"].map((part) => parts.isShown(part as never))).toEqual([false, false, false, false]);
    expect(parts.home()).toBe("code");
  });

  it("hides parts for the user in every repository, or in this one alone", async () => {
    const { parts, managers, session } = await setup();
    await parts.setHidden("terminal", true, true);
    expect(managers.workspace.setPreferences).toHaveBeenLastCalledWith({ hiddenParts: { all: ["terminal"], repositories: {} } });
    expect(parts.isShown("terminal")).toBe(false);
    expect(parts.ownChoice()).toBe(false);

    await parts.setOwnChoice(true);
    expect(session.preferences().hiddenParts).toEqual({ all: ["terminal"], repositories: { [KEY]: ["terminal"] } });
    await parts.setHidden("tasks", true, false);
    expect(session.preferences().hiddenParts.repositories[KEY]).toEqual(["tasks", "terminal"]);
    expect(parts.isShown("planning")).toBe(false);
    // Showing planning shows the tasks it needs.
    await parts.setHidden("planning", false, false);
    expect(parts.isShown("tasks")).toBe(true);

    await parts.setOwnChoice(false);
    expect(session.preferences().hiddenParts).toEqual({ all: ["terminal"], repositories: {} });
  });
});
