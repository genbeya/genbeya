import { TestBed } from "@angular/core/testing";
import type { FieldDefinition } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { FieldEditor } from "./field-editor";

async function render(value: readonly FieldDefinition[]) {
  const fixture = TestBed.createComponent(FieldEditor);
  fixture.componentRef.setInput("value", value);
  const changes: FieldDefinition[][] = [];
  fixture.componentInstance.changed.subscribe((fields) => changes.push(fields));
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const change = (selector: string, value: string) => {
    const field = element.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!;
    field.value = value;
    field.dispatchEvent(new Event(field instanceof HTMLSelectElement || selector.includes("Options") ? "change" : "input"));
    return field;
  };
  return { fixture, element, change, changes };
}

describe("FieldEditor", () => {
  it("adds text fields named like frontmatter keys", async () => {
    const { change, changes } = await render([]);
    change("input[aria-label='New field']", "due date").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(changes).toEqual([[{ name: "due-date", type: "text" }]]);
  });

  it("explains names Settings would refuse, built-in properties among them, and keeps them to correct", async () => {
    const { fixture, element, change, changes } = await render([{ name: "area", type: "text" }]);
    const field = change("input[aria-label='New field']", "Status");
    await settle(fixture);
    expect(element.querySelector("[role=alert]")!.textContent).toContain("built-in task property");
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(changes).toEqual([]);
    expect(field.value).toBe("Status");
    change("input[aria-label='New field']", "AREA");
    await settle(fixture);
    expect(element.querySelector("[role=alert]")!.textContent).toContain("already");
    change("input[aria-label='New field']", "2nd");
    await settle(fixture);
    expect(element.querySelector("[role=alert]")!.textContent).toContain("Start with a letter");
    change("input[aria-label='New field']", "reviewer");
    await settle(fixture);
    expect(element.querySelector("[role=alert]")).toBeNull();
  });

  it("gives choice fields options, and drops them for other kinds", async () => {
    const { fixture, change, changes } = await render([{ name: "area", type: "text" }]);
    change("select[aria-label='Kind of area']", "choice");
    expect(changes.at(-1)).toEqual([{ name: "area", type: "choice", options: [] }]);
    fixture.componentRef.setInput("value", changes.at(-1));
    await settle(fixture);
    change("input[aria-label='Options of area']", "ui, backend,, ui");
    expect(changes.at(-1)).toEqual([{ name: "area", type: "choice", options: ["ui", "backend"] }]);
    change("select[aria-label='Kind of area']", "number");
    expect(changes.at(-1)).toEqual([{ name: "area", type: "number" }]);
  });
});
