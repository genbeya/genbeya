import { describe, expect, it } from "vitest";
import { dependenciesOf, effortOf, planTasks } from "../utilities/planning";
import { validateRepositoryPath } from "../utilities/repository-path";
import { REPORT_LINES, SampleEngine } from "./sample-engine";
import { SETTINGS_FILE, SettingsEngine } from "./settings-engine";
import { TaskEngine } from "./task-engine";
import { WikiEngine } from "./wiki-engine";

const engine = new SampleEngine();
/** Every file as the sample ends up, later steps overwriting earlier ones. */
const files = new Map(engine.steps().flatMap((step) => step.files.map((file) => [file.path, file.content] as const)));
const settingsEngine = new SettingsEngine();
const settings = settingsEngine.parse(files.get(SETTINGS_FILE)!, settingsEngine.defaults(engine.folderName), true);

describe("SampleEngine", () => {
  it("has valid settings that hide a column", () => {
    expect(settings).toMatchObject({ name: "Pocket Weather", taskPrefix: "PW", hiddenColumns: ["backlog"] });
    expect(settings.types.map((type) => type.name)).toEqual(["feature", "bug", "docs", "chore"]);
    expect(settings.fields).toEqual([
      { name: "estimate", type: "effort" },
      { name: "remaining", type: "effort" },
      { name: "depends_on", type: "tasks" },
    ]);
  });

  it("names only paths a repository may hold, on every file system", () => {
    for (const path of files.keys()) expect(validateRepositoryPath(path, true)).toBe(path);
  });

  it("has tasks that parse, with unique IDs, in every state and in an epic", () => {
    const tasks = new TaskEngine();
    const parsed = [...files]
      .filter(([path]) => tasks.isTaskFile(path, settings.taskRoot))
      .map(([path, content]) => tasks.parse(path, content, "hash", settings.taskRoot));
    expect(new Set(parsed.map((task) => task.id)).size).toBe(parsed.length);
    expect(new Set(parsed.map((task) => task.status))).toEqual(new Set(settings.statuses));
    expect(parsed.filter((task) => task.epic === "Release 1.0")).toHaveLength(2);
    expect(parsed.every((task) => settings.types.some((type) => type.name === task.type))).toBe(true);
    expect(tasks.parseTemplate(files.get(tasks.templatePath(settings.taskRoot, "bug"))!)).toMatchObject({ priority: "high" });
    for (const task of parsed) {
      expect(task.path).toBe(tasks.pathOf(settings.taskRoot, task.epic, task.id));
      expect(tasks.validate(task, settings.statuses)).toMatchObject({ title: task.title, status: task.status });
    }
  });

  it("has a wiki with a home page, subpages and diagrams", () => {
    const wiki = new WikiEngine().tree([...files.keys()], settings);
    expect(wiki.map((page) => page.title)).toEqual(["Home", "Architecture", "Release plan", "Where files live"]);
    expect(wiki[1]!.children.map((page) => page.title)).toEqual(["Forecast source"]);
    expect(files.get("docs/Architecture.md")).toMatch(/```mermaid[\s\S]*```plantuml/);
  });

  it("plans: effort and time logs that add up, and a task blocked by others", () => {
    const tasks = new TaskEngine();
    const parsed = [...files]
      .filter(([path]) => tasks.isTaskFile(path, settings.taskRoot))
      .map(([path, content]) => tasks.parse(path, content, "hash", settings.taskRoot));
    const plan = planTasks(parsed);
    const byId = (id: string) => plan.find((task) => task.id === id)!;
    expect(effortOf(byId("PW-1"), true)).toEqual({ estimate: 4, logged: 5, remaining: 0, forecast: 5, variance: 1 });
    expect(effortOf(byId("PW-2"), false)).toEqual({ estimate: 8, logged: 4, remaining: 3, forecast: 7, variance: -1 });
    expect(plan.every((task) => task.unreadable === 0)).toBe(true);
    const dependencies = dependenciesOf(plan, settings.statuses);
    expect(dependencies.states.get("PW-6")).toBe("blocked");
    expect(dependencies.problems.size).toBe(0);
    expect(files.get("docs/Release-plan.md")).toMatch(/\[EFFORT\][\s\S]*\[DEPENDENCIES\][\s\S]*\[GANTT\]/);
  });

  it("embeds the lines of the report function", () => {
    const [path, range] = REPORT_LINES.split("#L");
    const [from, to] = range!.split("-L").map(Number);
    const lines = files.get(path!)!.split("\n");
    expect(lines[from! - 1]).toMatch(/^export function report/);
    expect(lines[to! - 1]).toBe("}");
    expect(files.get("docs/Home.md")).toContain(`![[${REPORT_LINES}]]`);
  });

  it("commits all but the last step, which leaves a change to commit", () => {
    const steps = engine.steps();
    expect(steps.slice(0, -1).every((step) => step.message)).toBe(true);
    expect(steps.at(-1)!.message).toBeUndefined();
    expect(steps.at(-1)!.files.every((file) => steps.slice(0, -1).some((step) => step.files.some((f) => f.path === file.path)))).toBe(true);
  });
});
