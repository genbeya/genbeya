import { describe, expect, it } from "vitest";
import type { Settings } from "../contracts/model";
import { SettingsEngine } from "./settings-engine";

const engine = new SettingsEngine();
const defaults = engine.defaults("Test Project");

describe("SettingsEngine", () => {
  it("derives a task prefix from the project name", () => {
    expect(engine.defaults("GitDesk").taskPrefix).toBe("GD");
    expect(engine.defaults("my project").taskPrefix).toBe("MP");
    expect(engine.defaults("atlas").taskPrefix).toBe("ATL");
    expect(engine.defaults("---").taskPrefix).toBe("T");
  });

  it("starts with docs, tasks and five workflow states", () => {
    expect(defaults).toEqual({
      name: "Test Project",
      wikiRoot: "docs",
      wikiHome: "Home.md",
      taskRoot: "tasks",
      taskPrefix: "TP",
      statuses: ["backlog", "todo", "in-progress", "review", "done"],
    });
  });

  it("parses partial files over the defaults", () => {
    expect(engine.parse("name: Atlas\ntaskPrefix: at\n", defaults)).toEqual({ ...defaults, name: "Atlas", taskPrefix: "AT" });
  });

  it.each([
    ["name: [broken\n", ""],
    ["- a\n", "YAML mapping"],
    ["wikiRoot: tasks\n", "contain each other"],
    ["wikiRoot: docs\ntaskRoot: docs/tasks\n", "contain each other"],
    ["statuses: []\n", "workflow states"],
    ["statuses: [a, a]\n", "workflow states"],
    ["taskPrefix: 1A\n", "task prefix"],
    ["wikiHome: Home.txt\n", "Markdown file"],
    ["wikiRoot: ../outside\n", "not a valid path"],
    ["name: ''\n", "Project name is required"],
  ])("rejects %j", (content, message) => {
    expect(() => engine.parse(content, defaults)).toThrow(message);
  });

  it("serialises over the previous file, keeping comments and unknown keys", () => {
    const text = engine.serialize({ ...defaults, name: "B" }, "# comment\nname: A\ncustom: true\n");
    expect(text).toContain("# comment");
    expect(text).toContain("custom: true");
    expect(engine.parse(text, defaults).name).toBe("B");
  });

  it("starts fresh when the previous file is unreadable", () => {
    expect(engine.parse(engine.serialize(defaults, "name: [broken"), defaults)).toEqual(defaults);
  });

  it("validates before serialising", () => {
    expect(() => engine.serialize({ ...defaults, statuses: [] } as Settings, null)).toThrow("workflow states");
  });
});
