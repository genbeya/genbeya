import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import { settle } from "../../testing/component-harness";
import { defaultMergeMessage, MergeDialog, type MergeRequest } from "./merge-dialog";

async function render(request: MergeRequest) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_DATA, useValue: request },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(MergeDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  return { fixture, element, close, form: element.querySelector("form")!, field: element.querySelector("textarea")! };
}

describe("MergeDialog", () => {
  it("prefills git's message and lets git write it when it is left alone", async () => {
    const { form, field, close } = await render({ source: "feature", kind: "branch", target: "dev" });
    expect(field.value).toBe("Merge branch 'feature' into dev");
    form.dispatchEvent(new Event("submit"));
    expect(close).toHaveBeenCalledWith({ noFastForward: false, message: "" });
  });

  it("passes an edited message and the choice to always create a merge commit", async () => {
    const { form, field, close, element, fixture } = await render({ source: "feature", kind: "branch", target: "main" });
    field.value = "Bring in the feature";
    field.dispatchEvent(new Event("input"));
    const always = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    always.checked = true;
    always.dispatchEvent(new Event("change"));
    await settle(fixture);
    form.dispatchEvent(new Event("submit"));
    expect(close).toHaveBeenCalledWith({ noFastForward: true, message: "Bring in the feature" });
  });
});

describe("defaultMergeMessage", () => {
  it("names what is merged as git does, leaving out the main branch", () => {
    expect(defaultMergeMessage({ source: "feature", kind: "branch", target: "main" })).toBe("Merge branch 'feature'");
    expect(defaultMergeMessage({ source: "origin/x", kind: "remote", target: "dev" })).toBe(
      "Merge remote-tracking branch 'origin/x' into dev",
    );
    expect(defaultMergeMessage({ source: "v1", kind: "tag", target: "master" })).toBe("Merge tag 'v1'");
    expect(defaultMergeMessage({ source: "a".repeat(40), kind: "commit", target: "main" })).toBe("Merge commit 'aaaaaaa'");
  });
});
