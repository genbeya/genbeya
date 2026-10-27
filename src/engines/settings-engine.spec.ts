import { describe, expect, it } from "vitest";
import { taskType, type Settings } from "../contracts/model";
import { SettingsEngine } from "./settings-engine";

const engine = new SettingsEngine();
const BOM = String.fromCharCode(0xfeff);
const CRLF = String.fromCharCode(13, 10);
const defaults = engine.defaults("Test Project");

describe("SettingsEngine", () => {
  it("derives a task prefix from the project name", () => {
    expect(engine.defaults("TaskBoard").taskPrefix).toBe("TB");
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
      statusIcons: {},
      hiddenColumns: [],
      types: [
        { name: "bug", icon: "bug", tone: "red" },
        { name: "feature", icon: "sparkles", tone: "purple" },
        { name: "improvement", icon: "trending-up", tone: "blue" },
        { name: "chore", icon: "wrench", tone: "gray" },
      ],
      fields: [],
      people: [],
      pullRoot: "pulls",
      pullPrefix: "PR",
      requiredApprovals: 1,
    });
  });

  describe("workflow states", () => {
    it("reads states as names, or as a name with an icon", () => {
      const settings = engine.parse("statuses:\n  - todo\n  - name: done\n    icon: circle-check\n", defaults, false);
      expect(settings.statuses).toEqual(["todo", "done"]);
      expect(settings.statusIcons).toEqual({ done: "circle-check" });
    });

    it("writes a state as its name unless it has an icon", () => {
      const text = engine.serialize({ ...defaults, statuses: ["todo", "done"], statusIcons: { done: "circle-check" } }, null, false);
      expect(text).toContain("statuses:\n  - todo\n  - name: done\n    icon: circle-check\n");
      expect(engine.parse(text, defaults, false)).toMatchObject({ statuses: ["todo", "done"], statusIcons: { done: "circle-check" } });
    });

    it("forgets the icons of states that no longer exist", () => {
      const settings = engine.validate({ ...defaults, statuses: ["todo"], statusIcons: { todo: "eye", gone: "ban" } }, false);
      expect(settings.statusIcons).toEqual({ todo: "eye" });
    });

    it.each([
      ["statuses: [{ icon: eye }]\n", "workflow states"],
      ["statuses: [{ name: todo, icon: 'Not An Icon' }]\n", "icon"],
    ])("rejects %j", (content, message) => {
      expect(() => engine.parse(content, defaults, false)).toThrow(message);
    });
  });

  describe("task types", () => {
    it("reads types with an icon and an optional colour", () => {
      const settings = engine.parse(
        "types:\n  - name: bug\n    icon: zap\n  - name: spike\n    icon: flask-conical\n    tone: orange\n",
        defaults,
        false,
      );
      expect(settings.types).toEqual([
        { name: "bug", icon: "zap" },
        { name: "spike", icon: "flask-conical", tone: "orange" },
      ]);
    });

    it("reads a list of names with the usual icons, and a generic one for other names", () => {
      expect(engine.parse("types: [bug, Feature, epic]\n", defaults, false).types).toEqual([
        { name: "bug", icon: "bug", tone: "red" },
        { name: "Feature", icon: "sparkles", tone: "purple" },
        { name: "epic", icon: "circle-dot" },
      ]);
    });

    it("allows a project without types", () => {
      expect(engine.parse("types: []\n", defaults, false).types).toEqual([]);
    });

    it("writes types with their usual look as names", () => {
      const types = [taskType("bug"), { name: "spike", icon: "zap" }];
      const text = engine.serialize({ ...defaults, types }, null, false);
      expect(text).toContain("types:\n  - bug\n  - name: spike\n    icon: zap\n");
      expect(engine.parse(text, defaults, false).types).toEqual(types);
    });

    it.each([
      ["types: [bug, Bug]\n", "unique"],
      ["types: ['a/b']\n", "type name"],
      ["types: ['.hidden']\n", "type name"],
      ["types: [{ name: bug }]\n", "icon"],
      ["types: [{ name: bug, icon: bug, tone: pink }]\n", "colour"],
      ["types: bug\n", "List the task types"],
    ])("rejects %j", (content, message) => {
      expect(() => engine.parse(content, defaults, false)).toThrow(message);
    });
  });

  describe("custom fields", () => {
    it("reads text, number, date and choice fields", () => {
      const settings = engine.parse(
        [
          "fields:",
          "  - { name: estimate, type: number }",
          "  - { name: due, type: date, options: [x] }",
          "  - { name: area, type: choice, options: [ui, backend] }",
          "  - { name: notes }",
        ].join("\n"),
        defaults,
        false,
      );
      expect(settings.fields).toEqual([
        { name: "estimate", type: "number" },
        { name: "due", type: "date" },
        { name: "area", type: "choice", options: ["ui", "backend"] },
        { name: "notes", type: "text" },
      ]);
    });

    it.each([
      ["fields: [{ name: Status, type: text }]\n", "built-in"],
      ["fields: [{ name: epic, type: text }]\n", "built-in"],
      ["fields: [{ name: 'due date', type: date }]\n", "field name"],
      ["fields: [{ name: '1st', type: text }]\n", "field name"],
      ["fields: [{ name: due, type: date }, { name: Due, type: text }]\n", "unique"],
      ["fields: [{ name: due, type: time }]\n", "text, number, date, choice, effort or tasks"],
      ["fields: [{ name: area, type: choice }]\n", "options"],
      ["fields: [{ name: area, type: choice, options: [a, a] }]\n", "options"],
      ["fields: estimate\n", "List the custom fields"],
    ])("rejects %j", (content, message) => {
      expect(() => engine.parse(content, defaults, false)).toThrow(message);
    });

    it("writes fields only while there are some", () => {
      expect(engine.serialize(defaults, null, false)).not.toContain("fields");
      const text = engine.serialize({ ...defaults, fields: [{ name: "estimate", type: "number" }] }, null, false);
      expect(engine.parse(text, defaults, false).fields).toEqual([{ name: "estimate", type: "number" }]);
    });
  });

  describe("people", () => {
    it("reads people with a handle and a name, and optionally an email and aliases", () => {
      const settings = engine.parse(
        "people:\n  - handle: ada\n    name: Ada Lovelace\n    email: ada@example.com\n    aliases: [Countess, ada@old.example]\n  - handle: bob\n    name: ' Bob '\n",
        defaults,
        false,
      );
      expect(settings.people).toEqual([
        { handle: "ada", name: "Ada Lovelace", email: "ada@example.com", aliases: ["Countess", "ada@old.example"] },
        { handle: "bob", name: "Bob" },
      ]);
    });

    it.each([
      ["people: ada\n", "List the people"],
      ["people: [ada]\n", "handle"],
      ["people: [{ handle: -ada, name: Ada }]\n", "handle"],
      ["people: [{ handle: ada.l, name: Ada }]\n", "handle"],
      ["people: [{ handle: ada }]\n", "name"],
      ["people: [{ handle: ada, name: Ada, email: ada }]\n", "email"],
      ["people: [{ handle: ada, name: Ada, aliases: Countess }]\n", "aliases"],
      ["people: [{ handle: ada, name: Ada }, { handle: ADA, name: Other }]\n", "unique"],
      ["people: [{ handle: ada, name: Ada, aliases: [bob] }, { handle: bob, name: Bob }]\n", "another person's handle"],
    ])("rejects %j", (content, message) => {
      expect(() => engine.parse(content, defaults, false)).toThrow(message);
    });

    it("writes people only while there are some, and keeps them when other settings change", () => {
      expect(engine.serialize(defaults, null, false)).not.toContain("people");
      const people = [{ handle: "ada", name: "Ada Lovelace", email: "ada@example.com" }];
      const text = engine.serialize({ ...defaults, people }, null, false);
      expect(text).toContain("people:\n  - handle: ada\n    name: Ada Lovelace\n    email: ada@example.com\n");
      const renamed = engine.serialize({ ...engine.parse(text, defaults, false), name: "B" }, text, false);
      expect(engine.parse(renamed, defaults, false).people).toEqual(people);
    });
  });

  it("leaves unchanged keys as they are written, and keeps default types out of new files", () => {
    const previous = "name: 'A'\ntypes: [bug, feature]\nstatuses: [todo, done]\n";
    const settings = engine.parse(previous, defaults, false);
    const text = engine.serialize({ ...settings, taskPrefix: "AB" }, previous, false);
    expect(text).toBe(`${previous}wikiRoot: docs\nwikiHome: Home.md\ntaskRoot: tasks\ntaskPrefix: AB\n`);
    expect(engine.serialize(defaults, null, false)).not.toContain("types");
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

  it("reads where pull requests live and how many approvals they need", () => {
    expect(engine.parse("pullRoot: reviews\npullPrefix: mr\nrequiredApprovals: 2\n", defaults, false)).toEqual({
      ...defaults,
      pullRoot: "reviews",
      pullPrefix: "MR",
      requiredApprovals: 2,
    });
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
    ["pullRoot: docs/pulls\n", "pull request folder"],
    ["pullRoot: .\n", ""],
    ["pullPrefix: 7A\n", "pull request prefix"],
    ["requiredApprovals: 1.5\n", "Required approvals"],
    ["requiredApprovals: 21\n", "Required approvals"],
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
    for (const value of [null, "x", []])
      expect(() => engine.serialize(value as unknown as Settings, null, false)).toThrow("Invalid settings");
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
