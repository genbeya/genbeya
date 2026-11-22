import { describe, expect, it } from "vitest";
import { dependentParts, PARTS, shownParts } from "./model";

describe("parts of the app", () => {
  it("takes the parts that need a hidden one along", () => {
    expect(dependentParts("tasks")).toEqual(["planning", "timelog"]);
    expect(dependentParts("planning")).toEqual(["timelog"]);
    expect(dependentParts("wiki")).toEqual([]);
    const shown = shownParts(["tasks", "terminal"]);
    expect(PARTS.filter((part) => !shown.has(part))).toEqual(["tasks", "planning", "timelog", "terminal"]);
    expect(shownParts([]).size).toBe(PARTS.length);
  });
});
