import type { Code, RootContent, Table } from "mdast";
import { toString } from "mdast-util-to-string";
import { describe, expect, it } from "vitest";
import { docsPlans, type RepositoryFile } from "./plans";

const SETTINGS = `name: Docs
wikiRoot: docs
wikiHome: Home.md
taskRoot: tasks
taskPrefix: DOC
statuses: [todo, in-progress, done]
fields:
  - name: estimate
    type: effort
  - name: duration
    type: effort
  - name: depends_on
    type: tasks
  - name: milestone
    type: text
`;

const task = (id: string, status: string, fields: string, body = "") =>
  `---\nid: ${id}\ntitle: Task ${id}\nstatus: ${status}\n${fields}---\n\n${body}`;

const FILES: RepositoryFile[] = [
  { path: "tasks/DOC-1.md", content: task("DOC-1", "done", "estimate: 8h\nduration: 1d\nmilestone: MVP\n") },
  { path: "tasks/DOC-2.md", content: task("DOC-2", "todo", "estimate: 2d\nduration: 2d\nmilestone: MVP\ndepends_on: [DOC-1]\n") },
  { path: "tasks/Epic/DOC-3.md", content: task("DOC-3", "todo", "duration: 1d\ndepends_on: [DOC-2]\n") },
  { path: "tasks/README.md", content: "# Not a task\n" },
  { path: "docs/Home.md", content: "# Not in the task folder\n" },
];

const TODAY = "2026-11-24";
const plans = () => docsPlans(SETTINGS, FILES, TODAY);
const kinds = (nodes: RootContent[] | null) => nodes?.map((node) => (node.type === "code" ? `code:${node.lang}` : node.type));

describe("docsPlans", () => {
  it("reads the tasks of the task folder, leaving out files that aren't tasks", () => {
    expect(plans().tasks).toBe(3);
  });

  it("draws effort and float as tables, with references to the tasks", () => {
    const effort = plans().draw("[EFFORT milestone=MVP]");
    expect(kinds(effort)?.[0]).toBe("table");
    const table = effort![0] as Table;
    expect(table.children.map((row) => toString(row.children[0]!))).toEqual(["Task", "[[DOC-1]]", "[[DOC-2]]", "Total, 2 tasks"]);
    const float = plans().draw("[FLOAT]");
    expect(kinds(float)?.[0]).toBe("table");
    expect(toString(float![1]!)).toContain(`Working days from today (${TODAY})`);
  });

  it("draws dependencies and the critical path as Mermaid, the timeline as PlantUML", () => {
    const dependencies = plans().draw("[DEPENDENCIES]");
    expect(kinds(dependencies)?.[0]).toBe("code:mermaid");
    expect((dependencies![0] as Code).value).toContain("DOC-2");
    expect(kinds(plans().draw("[ARROWS]"))?.[0]).toBe("code:mermaid");
    const gantt = plans().draw("[GANTT]");
    expect(kinds(gantt)?.[0]).toBe("code:plantuml");
    expect((gantt![0] as Code).value).toMatch(/^@startgantt/);
  });

  it("says when no task matches, as the app does", () => {
    expect(
      plans()
        .draw("[EFFORT milestone=NOPE]")
        ?.map((node) => toString(node)),
    ).toEqual(["No tasks match this plan."]);
  });

  it("draws nothing for plans over time, other text, or a project without planning", () => {
    expect(plans().draw("[BURNDOWN]")).toBeNull();
    expect(plans().draw("[BASELINE v1.0]")).toBeNull();
    expect(plans().draw("Just a paragraph")).toBeNull();
    expect(docsPlans(`${SETTINGS}unused: [planning]\n`, FILES, TODAY).draw("[EFFORT]")).toBeNull();
  });

  it("uses the default settings without a .genbeya.yml", () => {
    expect(docsPlans(null, FILES, TODAY).tasks).toBe(3);
  });

  it("returns plain data, which survives JSON", () => {
    const nodes = plans().draw("[EFFORT]");
    expect(JSON.parse(JSON.stringify(nodes))).toEqual(nodes);
  });
});
