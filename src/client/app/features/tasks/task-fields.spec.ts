import { TestBed } from "@angular/core/testing";
import type { TaskInput } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { SETTINGS, task } from "../../testing/fake-platform";
import { type FieldChange, TaskFields } from "./task-fields";
import { inputOf } from "./task-model";

const fields = [
  { name: "estimate", type: "number" },
  { name: "due", type: "date" },
  { name: "area", type: "choice", options: ["ui", "backend"] },
  { name: "notes", type: "text" },
] as const;

async function render(values: TaskInput["fields"]) {
  await openRepository({ settings: { ...SETTINGS, fields } });
  const fixture = TestBed.createComponent(TaskFields);
  fixture.componentRef.setInput("value", inputOf(task("TP-1", { fields: values })));
  const changes: FieldChange[] = [];
  fixture.componentInstance.changed.subscribe((change) => changes.push(change));
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const control = (name: string) => {
    const label = [...element.querySelectorAll("label")].find((label) => label.textContent!.trim() === name)!;
    return element.querySelector<HTMLInputElement & HTMLSelectElement>(`#${label.htmlFor}`)!;
  };
  const change = (name: string, value: string) => {
    const field = control(name);
    field.value = value;
    field.dispatchEvent(new Event("change"));
  };
  return { element, control, change, changes };
}

describe("TaskFields", () => {
  it("shows an editor for each configured field with the task's value", async () => {
    const { control } = await render({ estimate: 3, due: "2026-05-01", area: "backend" });
    expect(control("Estimate").type).toBe("number");
    expect(control("Estimate").value).toBe("3");
    expect(control("Due").type).toBe("date");
    expect(control("Due").value).toBe("2026-05-01");
    expect(control("Area").value).toBe("backend");
    expect(control("Notes").value).toBe("");
  });

  it("emits the changed field alone: numbers as numbers, emptied ones as empty text", async () => {
    const { change, changes } = await render({ estimate: 3, area: "ui" });
    change("Estimate", "5");
    change("Area", "");
    change("Notes", "Call Bob");
    change("Notes", "");
    expect(changes).toEqual([
      { name: "estimate", value: 5 },
      { name: "area", value: "" },
      { name: "notes", value: "Call Bob" },
    ]);
  });

  it("takes a date only once it is whole, not the years typing passes through", async () => {
    const { change, changes } = await render({});
    for (const value of ["0002-12-24", "0020-12-24", "0202-12-24", "2026-12-24"]) change("Due", value);
    change("Due", "");
    expect(changes).toEqual([{ name: "due", value: "2026-12-24" }]);
  });

  it("keeps a choice that is not an option, and shows fields the settings do not configure", async () => {
    const { control, element } = await render({ area: "legacy", reviewer: "ann" });
    expect([...control("Area").options].map((option) => option.value)).toEqual(["", "ui", "backend", "legacy"]);
    expect(control("Area").value).toBe("legacy");
    expect(element.querySelector(".task-field-value")!.textContent).toBe("ann");
  });

  it("hides itself without fields", async () => {
    await openRepository();
    const fixture = TestBed.createComponent(TaskFields);
    fixture.componentRef.setInput("value", inputOf(task("TP-1")));
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).hidden).toBe(true);
  });
});
