import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import { settle } from "../../testing/component-harness";
import { IgnoreDialog, type IgnoreRequest } from "./ignore-dialog";

async function render(request: IgnoreRequest) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_DATA, useValue: request },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(IgnoreDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const choose = async (location: string) => {
    const select = element.querySelector("select")!;
    select.value = location;
    select.dispatchEvent(new Event("change"));
    await settle(fixture);
  };
  const submit = async () => {
    element.querySelector("form")!.dispatchEvent(new Event("submit"));
    await settle(fixture);
  };
  return { element, close, choose, submit, preview: () => element.querySelector("pre")!.textContent };
}

describe("IgnoreDialog", () => {
  it("previews the rule in the root's .gitignore or the folder's", async () => {
    const { element, choose, submit, preview, close } = await render({ path: "src/app/debug[1].log", kind: "file", tracked: false });
    expect([...element.querySelectorAll("option")].map((option) => option.textContent)).toEqual([".gitignore", "src/app/.gitignore"]);
    expect(preview()).toBe("/src/app/debug\\[1].log");
    await choose("src/app");
    expect(preview()).toBe("/debug\\[1].log");
    expect(element.querySelector("input[type=checkbox]")).toBeNull();
    await submit();
    expect(close).toHaveBeenCalledWith({ location: "src/app", untrack: false });
  });

  it("names extensions and offers to stop tracking tracked files", async () => {
    const { element, submit, preview, close } = await render({ path: "out/app.min.js", kind: "extension", tracked: true });
    expect(element.querySelector("h2")!.textContent).toBe("Ignore all *.js files");
    expect(preview()).toBe("*.js");
    expect(element.textContent).toContain("Stop tracking out/app.min.js");
    await submit();
    expect(close).toHaveBeenCalledWith({ location: "", untrack: true });
  });
});
