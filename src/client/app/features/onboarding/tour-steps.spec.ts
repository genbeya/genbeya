import { shownParts } from "../../../../contracts/model";
import { appTour } from "./tour-steps";

const keys = { mod: "Ctrl", ctrl: "Ctrl" };

describe("appTour", () => {
  it("shows every part, starting in the wiki", () => {
    const steps = appTour(keys);
    expect(steps[0]).toMatchObject({ route: "/wiki", title: "One repository, six views" });
    expect(steps.some((step) => step.target.includes("terminal"))).toBe(true);
  });

  it("leaves out the steps of hidden parts and starts in the first view shown", () => {
    const steps = appTour(keys, shownParts(["wiki", "terminal"]), "tasks");
    expect(steps[0]!.route).toBe("/tasks");
    expect(steps.map((step) => step.target).join(" ")).not.toMatch(/wiki-tree|wiki-edit|terminal|page-header/);
    expect(steps.some((step) => step.route === "/tasks")).toBe(true);
    // Steps that belong to no part stay.
    expect(steps.some((step) => step.target.includes("search"))).toBe(true);
  });
});
