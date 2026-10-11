import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import { settle } from "../testing/component-harness";
import { PromptDialog, type PromptOptions } from "./prompt-dialog";

async function render(options: Partial<PromptOptions>) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_DATA, useValue: { title: "New page", label: "Page name", ...options } },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(PromptDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const field = element.querySelector<HTMLInputElement>("input")!;
  const enter = async (value: string) => {
    field.value = value;
    field.dispatchEvent(new Event("input"));
    element.querySelector("form")!.dispatchEvent(new Event("submit"));
    await settle(fixture);
  };
  return { element, field, close, enter };
}

describe("PromptDialog", () => {
  it("stays open with the value and the error when doing what it asked for fails", async () => {
    const accept = vi.fn(async (value: string) => (value === "Home" ? "A page named Home exists already." : null));
    const { element, field, close, enter } = await render({ accept });
    await enter("Home");
    expect(close).not.toHaveBeenCalled();
    expect(field.value).toBe("Home");
    expect(element.querySelector("[role=alert]")!.textContent).toContain("exists already");
    await enter("Guide");
    expect(accept).toHaveBeenLastCalledWith("Guide");
    expect(close).toHaveBeenCalledWith("Guide");
  });

  it("checks the value before doing anything with it", async () => {
    const accept = vi.fn(async () => null);
    const { element, close, enter } = await render({ accept, validate: (value) => (value.includes("..") ? "No dots" : null) });
    await enter("a..b");
    expect(accept).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(element.querySelector("[role=alert]")!.textContent).toContain("No dots");
  });
});
