import { Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { openRepository } from "../../testing/component-harness";
import { snapshot, task } from "../../testing/fake-platform";
import { VIEWS, ViewMemory } from "./view-memory";

@Component({ template: "" })
class Empty {}

const wiki = [
  { title: "Home", path: "docs/Home.md", folder: null, children: [] },
  { title: "Guide", path: "docs/Guide.md", folder: null, children: [] },
];
const files = [{ name: "README.md", path: "README.md" }];

async function setup() {
  const harness = await openRepository({ wiki, files, tasks: [task("TP-1"), task("TP-2")] });
  harness.router.resetConfig(VIEWS.map((path) => ({ path, component: Empty })));
  const memory = TestBed.inject(ViewMemory);
  return { ...harness, memory };
}

describe("ViewMemory", () => {
  it("returns each view to where it was left", async () => {
    const { router, memory } = await setup();
    await router.navigate(["/wiki"], { queryParams: { page: "docs/Guide.md" } });
    await router.navigate(["/tasks"], { queryParams: { task: "TP-2", epic: "Auth" } });
    await router.navigate(["/code"], { queryParams: { file: "README.md" } });
    expect(memory.params("wiki")).toEqual({ page: "docs/Guide.md" });
    expect(memory.params("tasks")).toEqual({ task: "TP-2", epic: "Auth" });
    await memory.open("wiki");
    expect(router.url).toBe("/wiki?page=docs%2FGuide.md");
  });

  it("forgets what was asked for once, such as a line or a new task", async () => {
    const { router, memory } = await setup();
    await router.navigate(["/wiki"], { queryParams: { page: "docs/Guide.md", line: 12 } });
    await router.navigate(["/tasks"], { queryParams: { create: "todo" } });
    expect(memory.params("wiki")).toEqual({ page: "docs/Guide.md" });
    expect(memory.params("tasks")).toEqual({});
  });

  it("leaves out pages, tasks and files that are gone", async () => {
    const { router, memory, session, managers } = await setup();
    await router.navigate(["/wiki"], { queryParams: { page: "docs/Guide.md" } });
    await router.navigate(["/tasks"], { queryParams: { task: "TP-2" } });
    managers.workspace.snapshot.mockResolvedValue(snapshot({ version: "v2", wiki: wiki.slice(0, 1), files, tasks: [task("TP-1")] }));
    await session.refresh();
    expect(memory.params("wiki")).toEqual({});
    expect(memory.params("tasks")).toEqual({});
  });

  it("starts empty for views not visited yet", async () => {
    const { memory } = await setup();
    expect(memory.params("history")).toEqual({});
  });
});
