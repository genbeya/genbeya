import { describe, expect, it } from "vitest";
import type { Settings } from "../contracts/model";
import { SettingsEngine } from "./settings-engine";

const engine = new SettingsEngine();
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);
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
      hiddenColumns: [],
    });
  });

  it("hides configured columns from the board, forgetting states that no longer exist", () => {
    const settings = engine.parse("hiddenColumns: [backlog, gone, backlog]", defaults, false);
    expect(settings.hiddenColumns).toEqual(["backlog"]);
    expect(() => engine.parse("hiddenColumns: backlog", defaults, false)).toThrow("hidden columns");
  });

  it("writes hidden columns only while there are some", () => {
    expect(engine.serialize(defaults, null, false)).not.toContain("hiddenColumns");
    const hidden = engine.serialize({ ...defaults, hiddenColumns: ["done"] }, null, false);
    expect(engine.parse(hidden, defaults, false).hiddenColumns).toEqual(["done"]);
    expect(engine.serialize(defaults, hidden, false)).not.toContain("hiddenColumns");
  });

  it("parses partial files over the defaults", () => {
    expect(engine.parse("name: Atlas\ntaskPrefix: at\n", defaults, false)).toEqual({ ...defaults, name: "Atlas", taskPrefix: "AT" });
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
    expect(() => engine.parse(content, defaults, false)).toThrow(message);
  });

  it("serialises over the previous file, keeping comments and unknown keys", () => {
    const text = engine.serialize({ ...defaults, name: "B" }, "# comment\nname: A\ncustom: true\n", false);
    expect(text).toContain("# comment");
    expect(text).toContain("custom: true");
    expect(engine.parse(text, defaults, false).name).toBe("B");
  });

  it("starts fresh when the previous file is unreadable", () => {
    expect(engine.parse(engine.serialize(defaults, "name: [broken", false), defaults, false)).toEqual(defaults);
  });

  it("validates before serialising", () => {
    expect(() => engine.serialize({ ...defaults, statuses: [] } as Settings, null, false)).toThrow("workflow states");
  });

  it.each(["taskRoot: GIT~1/info\n", "taskRoot: tasks.\n", "wikiRoot: docs:stream\n", "wikiHome: con.md\n"])(
    "rejects Windows aliases in %j on Windows hosts only",
    (content) => {
      expect(() => engine.parse(content, defaults, true)).toThrow("not a valid path");
      expect(() => engine.parse(content, defaults, false)).not.toThrow();
    },
  );

  it("keeps the byte order mark and CRLF line endings of the previous file", () => {
    const previous = `${BOM}# comment${CRLF}name: A${CRLF}`;
    const text = engine.serialize({ ...defaults, name: "B" }, previous, false);
    expect(text.startsWith(`${BOM}# comment${CRLF}name: B${CRLF}`)).toBe(true);
    expect(text.split(CRLF).join("")).not.toContain("\n");
    expect(engine.parse(text, defaults, false).name).toBe("B");
  });
});
