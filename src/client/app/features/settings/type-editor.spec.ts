import { TestBed } from "@angular/core/testing";
import type { TaskType } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { TypeEditor } from "./type-editor";

async function render(value: readonly TaskType[]) {
  const fixture = TestBed.createComponent(TypeEditor);
  fixture.componentRef.setInput("value", value);
  const changes: TaskType[][] = [];
  const templates: string[] = [];
  fixture.componentInstance.changed.subscribe((types) => changes.push(types));
  fixture.componentInstance.editTemplate.subscribe((type) => templates.push(type));
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const add = (name: string) => {
    const field = element.querySelector<HTMLInputElement>("input[aria-label='New task type']")!;
    field.value = name;
    field.dispatchEvent(new Event("input"));
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  };
  return { element, add, changes, templates };
}

describe("TypeEditor", () => {
  const bug: TaskType = { name: "bug", icon: "bug", tone: "red" };

  it("adds types with the usual icon of their name, once", async () => {
    const { add, changes } = await render([bug]);
    add("Feature");
    add("User story");
    add("BUG");
    expect(changes).toEqual([
      [bug, { name: "feature", icon: "sparkles", tone: "purple" }],
      [bug, { name: "user-story", icon: "circle-dot" }],
    ]);
  });

  it("changes a type's colour, and drops it for no colour", async () => {
    const { element, changes } = await render([bug]);
    const select = element.querySelector<HTMLSelectElement>("select[aria-label='Colour of Bug']")!;
    select.value = "blue";
    select.dispatchEvent(new Event("change"));
    select.value = "";
    select.dispatchEvent(new Event("change"));
    expect(changes).toEqual([[{ ...bug, tone: "blue" }], [{ name: "bug", icon: "bug" }]]);
  });

  it("asks to edit a type's template", async () => {
    const { element, templates } = await render([bug]);
    element.querySelector<HTMLButtonElement>("button[aria-label='Edit the bug template']")!.click();
    expect(templates).toEqual(["bug"]);
  });
});
