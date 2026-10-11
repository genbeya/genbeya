import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import type { PushPlan } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { PushDialog } from "./push-dialog";

const PLAN: PushPlan = {
  branch: "feature",
  upstream: null,
  remotes: [
    { remote: "backup", defaultBranch: null, branches: [] },
    { remote: "origin", defaultBranch: "main", branches: ["main", "release"] },
  ],
};

async function render(change: Partial<PushPlan> = {}) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_DATA, useValue: { plan: { ...PLAN, ...change } } },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(PushDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const name = element.querySelector<HTMLInputElement>("input.input")!;
  const checkbox = (label: string) =>
    [...element.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].find((input) =>
      input.closest("label")!.textContent!.includes(label),
    )!;
  const type = async (value: string) => {
    name.value = value;
    name.dispatchEvent(new Event("input"));
    await settle(fixture);
  };
  const toggle = async (label: string) => {
    const input = checkbox(label);
    input.checked = !input.checked;
    input.dispatchEvent(new Event("change"));
    await settle(fixture);
  };
  const submit = () => element.querySelector("form")!.dispatchEvent(new Event("submit"));
  return { element, fixture, close, name, checkbox, type, toggle, submit, select: element.querySelector("select")! };
}

describe("PushDialog", () => {
  it("publishes to origin under the same name, as the upstream, unless told otherwise", async () => {
    const { select, name, checkbox, submit, close } = await render();
    expect(select.value).toBe("origin");
    expect(name.value).toBe("feature");
    expect(checkbox("Set as upstream").checked).toBe(true);
    expect(checkbox("Force").checked).toBe(false);
    submit();
    expect(close).toHaveBeenCalledWith({ remote: "origin", remoteBranch: "feature", setUpstream: true, force: false });
  });

  it("pushes to the upstream by default, leaving it as it is", async () => {
    const { select, name, checkbox, element } = await render({ upstream: { remote: "origin", branch: "release" } });
    expect(select.value).toBe("origin");
    expect(name.value).toBe("release");
    expect(checkbox("Set as upstream").checked).toBe(false);
    expect(element.querySelector(".dialog-warning")).toBeNull();
    expect(element.textContent).toContain("feature keeps pulling from and pushing to origin/release.");
  });

  it("warns before pushing to the remote's default branch or another existing branch", async () => {
    const { type, element, toggle, submit, close } = await render();
    await type("main");
    expect(element.querySelector(".dialog-warning")!.textContent).toContain("main is the default branch of origin");
    await type("release");
    expect(element.querySelector(".dialog-warning")!.textContent).toContain("origin already has a branch release");
    await type(" new-name ");
    expect(element.querySelector(".dialog-warning")).toBeNull();
    await toggle("Set as upstream");
    await toggle("Force");
    expect(element.querySelector("button[type=submit]")!.textContent!.trim()).toBe("Force push…");
    submit();
    expect(close).toHaveBeenCalledWith({ remote: "origin", remoteBranch: "new-name", setUpstream: false, force: true });
  });

  it("pushes to another remote, and not without a branch name", async () => {
    const { select, fixture, type, submit, close } = await render();
    select.value = "backup";
    select.dispatchEvent(new Event("change"));
    await settle(fixture);
    await type("  ");
    submit();
    expect(close).not.toHaveBeenCalled();
    await type("feature");
    submit();
    expect(close).toHaveBeenCalledWith({ remote: "backup", remoteBranch: "feature", setUpstream: true, force: false });
  });
});
