import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import type { LinkUpdate } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { MovePageDialog } from "./move-page-dialog";

const LINKS: LinkUpdate[] = [
  {
    path: "docs/Home.md",
    changes: [
      { line: 3, before: "Guide.md", after: "Manual.md" },
      { line: 7, before: "Guide/Wiki", after: "Manual/Wiki" },
    ],
  },
  { path: "tasks/TP-1.md", changes: [{ line: 6, before: "../docs/Guide.md", after: "../docs/Manual.md" }] },
];

async function render(links: LinkUpdate[]) {
  const close = vi.fn();
  const { managers } = await openRepository({}, [
    { provide: DialogRef, useValue: { close } },
    { provide: DIALOG_DATA, useValue: { path: "docs/Guide.md" } },
  ]);
  managers.content.pageLinks.mockResolvedValue(links);
  const fixture = TestBed.createComponent(MovePageDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const field = element.querySelector<HTMLInputElement>(".field input")!;
  const checkbox = () => element.querySelector<HTMLInputElement>(".move-links input[type=checkbox]");
  const rename = async (value: string) => {
    field.value = value;
    field.dispatchEvent(new Event("input"));
    // The links are looked up once typing pauses.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await settle(fixture);
  };
  const submit = async () => {
    element.querySelector("form")!.dispatchEvent(new Event("submit"));
    await settle(fixture);
  };
  return { managers, close, element, field, checkbox, rename, submit };
}

describe("MovePageDialog", () => {
  it("starts with the page's name", async () => {
    const { field, managers } = await render(LINKS);
    expect(field.value).toBe("Guide");
    expect(managers.content.pageLinks).not.toHaveBeenCalled();
  });

  it("offers to update the links to the page, and lists them", async () => {
    const { managers, element, checkbox, rename, submit, close } = await render(LINKS);
    await rename("Manual");
    expect(managers.content.pageLinks).toHaveBeenCalledWith("w1", "docs/Guide.md", "docs/Manual.md");
    expect(checkbox()!.checked).toBe(true);
    expect(element.querySelector(".move-links label")!.textContent!.trim()).toBe("Update 3 links in 2 pages");
    const files = [...element.querySelectorAll(".move-links details > ul > li > span")].map((file) => file.textContent);
    expect(files).toEqual(["docs/Home.md", "tasks/TP-1.md"]);
    const rows = [...element.querySelectorAll(".move-links li li")].map((row) => [...row.children].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["3", "Guide.md", "Manual.md"],
      ["7", "Guide/Wiki", "Manual/Wiki"],
      ["6", "../docs/Guide.md", "../docs/Manual.md"],
    ]);
    await submit();
    expect(close).toHaveBeenCalledWith({ to: "docs/Manual.md", updateLinks: true });
  });

  it("moves without updating links when unchecked", async () => {
    const { checkbox, rename, submit, close } = await render(LINKS);
    await rename("Archive/Guide");
    checkbox()!.click();
    await submit();
    expect(close).toHaveBeenCalledWith({ to: "docs/Archive/Guide.md", updateLinks: false });
  });

  it("shows nothing more when no links point at the page", async () => {
    const { element, rename } = await render([]);
    await rename("Manual");
    expect(element.querySelector(".move-links")).toBeNull();
  });

  it("explains names it cannot use", async () => {
    const { element, managers, rename, submit, close } = await render(LINKS);
    await rename("../Outside");
    await submit();
    expect(element.querySelector(".dialog-error")!.textContent).toContain("Use letters");
    expect(managers.content.pageLinks).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});
