import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import type { ResetPlan } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { ResetDialog, type ResetRequest } from "./reset-dialog";

const PLAN: ResetPlan = {
  branch: "main",
  head: "b".repeat(40),
  target: "a".repeat(40),
  commits: 2,
  upstream: null,
  pushed: 0,
  uncommitted: [],
  overwritten: [],
  state: "s".repeat(64),
};

async function render(change: Partial<ResetPlan> = {}) {
  const close = vi.fn();
  const request: ResetRequest = { plan: { ...PLAN, ...change }, at: "aaaaaaa Start" };
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_DATA, useValue: request },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(ResetDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const choose = async (label: RegExp) => {
    const radio = [...element.querySelectorAll<HTMLInputElement>("input[type=radio]")].find((input) =>
      label.test(input.closest("label")!.textContent!),
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change"));
    await settle(fixture);
  };
  const submit = () => element.querySelector("form")!.dispatchEvent(new Event("submit"));
  const button = () => element.querySelector<HTMLButtonElement>("button[type=submit]")!;
  return { element, fixture, close, choose, submit, button };
}

describe("ResetDialog", () => {
  it("explains every mode and keeps the changes unstaged unless told otherwise", async () => {
    const { element, submit, close } = await render();
    expect([...element.querySelectorAll("input[type=radio] + span strong")].map((label) => label.textContent)).toEqual([
      "Soft",
      "Mixed",
      "Keep",
      "Hard",
    ]);
    expect(element.textContent).toContain("2 commits leave main.");
    submit();
    expect(close).toHaveBeenCalledWith("mixed");
  });

  it("resets hard over uncommitted changes only once the loss is confirmed", async () => {
    const { element, fixture, choose, submit, button, close } = await render({ uncommitted: ["a.ts", "b.ts"] });
    await choose(/Hard/);
    expect(element.textContent).toContain("Your uncommitted changes to 2 files are lost: a.ts, b.ts.");
    expect(button().disabled).toBe(true);
    submit();
    expect(close).not.toHaveBeenCalled();
    const confirm = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change"));
    await settle(fixture);
    expect(button().disabled).toBe(false);
    expect(button().classList).toContain("btn-danger");
    submit();
    expect(close).toHaveBeenCalledWith("hard");
  });

  it.each([
    [/Hard/, "hard"],
    [/Keep Files/, "keep"],
  ])("names the untracked files a %s reset replaces, and asks again", async (label, mode) => {
    const { element, fixture, choose, button, submit, close } = await render({ overwritten: [".env", "notes.txt"] });
    expect(element.textContent).not.toContain("replaced");
    await choose(label);
    expect(element.textContent).toContain(
      "The commit has 2 files you have but Git does not track here, which are replaced with the commit's: .env, notes.txt.",
    );
    expect(button().disabled).toBe(true);
    const confirm = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(confirm.closest("label")!.textContent).toContain("Replace these files");
    confirm.checked = true;
    confirm.dispatchEvent(new Event("change"));
    await settle(fixture);
    submit();
    expect(close).toHaveBeenCalledWith(mode);
  });

  it("resets hard without asking again when nothing uncommitted is lost", async () => {
    const { choose, submit, close, element } = await render();
    await choose(/Hard/);
    expect(element.querySelector("input[type=checkbox]")).toBeNull();
    submit();
    expect(close).toHaveBeenCalledWith("hard");
  });

  it("warns that pushed commits come back as behind and need a force push to go", async () => {
    const { element } = await render({ upstream: "origin/main", pushed: 1 });
    expect(element.textContent).toContain("1 of them is already on origin/main");
    expect(element.textContent).toContain("force push");
  });
});
