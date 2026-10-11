import { DIALOG_DATA, DialogRef } from "@angular/cdk/dialog";
import { TestBed } from "@angular/core/testing";
import type { Commit, ForcePushPlan } from "../../../../contracts/model";
import { settle } from "../../testing/component-harness";
import { ForcePushDialog, type ForcePushRequest } from "./force-push-dialog";

const commit = (hash: string, subject: string): Commit => ({
  hash: hash.repeat(40),
  parents: [],
  author: "Ann",
  email: "ann@example.com",
  date: new Date().toISOString(),
  subject,
  refs: [],
});

async function render(plan: ForcePushPlan) {
  const close = vi.fn();
  const request: ForcePushRequest = { plan, branch: "feature", remote: "origin", remoteBranch: "feature" };
  TestBed.configureTestingModule({
    providers: [
      { provide: DIALOG_DATA, useValue: request },
      { provide: DialogRef, useValue: { close } },
    ],
  });
  const fixture = TestBed.createComponent(ForcePushDialog);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const submit = () => element.querySelector("form")!.dispatchEvent(new Event("submit"));
  return { element, fixture, close, submit, button: element.querySelector<HTMLButtonElement>("button[type=submit]")! };
}

describe("ForcePushDialog", () => {
  it("lists the commits the remote branch loses, and the commit the lease expects", async () => {
    const { element, submit, close } = await render({
      expected: "e".repeat(40),
      removed: [commit("a", "Their fix"), commit("b", "Their feature")],
      total: 3,
      defaultBranch: false,
    });
    expect(element.textContent).toContain("These 3 commits are on origin/feature but not on feature");
    const rows = [...element.querySelectorAll("[aria-label='Commits the remote branch loses'] li")].map((row) =>
      [...row.children].map((part) => part.textContent!.trim()),
    );
    expect(rows).toEqual([["aaaaaaa", "Their fix", "Ann · now"], ["bbbbbbb", "Their feature", "Ann · now"], []]);
    expect(element.querySelectorAll("li")[2]!.textContent!.trim()).toBe("and 1 more");
    expect(element.textContent).toContain("while origin/feature is still at eeeeeee");
    submit();
    expect(close).toHaveBeenCalledWith({ defaultBranch: false });
  });

  it("says when nothing is removed, or the branch is new", async () => {
    expect((await render({ expected: "e".repeat(40), removed: [], total: 0, defaultBranch: false })).element.textContent).toContain(
      "has no commits that feature lacks",
    );
    TestBed.resetTestingModule();
    expect((await render({ expected: null, removed: [], total: 0, defaultBranch: false })).element.textContent).toContain(
      "Your last fetch saw no branch origin/feature",
    );
  });

  it("force pushes to the default branch only once the user says they know", async () => {
    const { element, fixture, button, submit, close } = await render({
      expected: "e".repeat(40),
      removed: [commit("a", "Theirs")],
      total: 1,
      defaultBranch: true,
    });
    expect(button.disabled).toBe(true);
    submit();
    expect(close).not.toHaveBeenCalled();
    const know = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    know.checked = true;
    know.dispatchEvent(new Event("change"));
    await settle(fixture);
    expect(button.disabled).toBe(false);
    submit();
    expect(close).toHaveBeenCalledWith({ defaultBranch: true });
  });
});
