import { TestBed } from "@angular/core/testing";
import type { Change } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { ChangesView } from "./changes-view";

async function render(changes: Change[]) {
  const harness = await openRepository({ changes });
  vi.spyOn(harness.router, "navigate").mockResolvedValue(true);
  harness.managers.versionControl.diff.mockResolvedValue({ path: "a.ts", original: "", modified: "x", binary: false });
  const fixture = TestBed.createComponent(ChangesView);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const commitButton = () => [...element.querySelectorAll<HTMLButtonElement>(".commit-box button")].at(-1)!;
  const typeMessage = async (text: string) => {
    const field = element.querySelector<HTMLTextAreaElement>("textarea")!;
    field.value = text;
    field.dispatchEvent(new Event("input"));
    await settle(fixture);
  };
  return { ...harness, fixture, element, commitButton, typeMessage };
}

describe("ChangesView", () => {
  it("commits everything when nothing is staged", async () => {
    const { commitButton, typeMessage, managers } = await render([
      { path: "a.ts", index: " ", worktree: "M" },
      { path: "new.ts", index: "?", worktree: "?" },
    ]);
    expect(commitButton().textContent!.trim()).toBe("Commit all 2");
    expect(commitButton().disabled).toBe(true);
    await typeMessage("All of it");
    commitButton().click();
    await vi.waitFor(() => expect(managers.versionControl.commit).toHaveBeenCalledWith("w1", "All of it", false));
    expect(managers.versionControl.stage).toHaveBeenCalledWith("w1", ["a.ts", "new.ts"]);
  });

  it("commits only staged changes when there are some", async () => {
    const { commitButton, typeMessage, managers } = await render([
      { path: "a.ts", index: "M", worktree: " " },
      { path: "b.ts", index: " ", worktree: "M" },
    ]);
    expect(commitButton().textContent!.trim()).toBe("Commit 1");
    await typeMessage("Just a");
    commitButton().click();
    await vi.waitFor(() => expect(managers.versionControl.commit).toHaveBeenCalled());
    expect(managers.versionControl.stage).not.toHaveBeenCalled();
  });

  it("fills in the last message when amending", async () => {
    const { element, managers, fixture, commitButton } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    managers.versionControl.lastCommitMessage.mockResolvedValue("Previous message");
    const amend = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    amend.checked = true;
    amend.dispatchEvent(new Event("change"));
    await settle(fixture);
    expect(element.querySelector("textarea")!.value).toBe("Previous message");
    expect(commitButton().textContent!.trim()).toBe("Amend");
  });

  it("asks before discarding changes", async () => {
    const { fixture, dialogs, managers } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    dialogs.confirm.mockResolvedValue(false);
    (fixture.componentInstance as unknown as { discard(paths: string[]): Promise<void> }).discard(["a.ts"]);
    await settle(fixture);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Discard changes", danger: true }));
    expect(managers.versionControl.discard).not.toHaveBeenCalled();
  });

  it("selects the first change", async () => {
    const { router } = await render([{ path: "b.ts", index: " ", worktree: "M" }]);
    expect(router.navigate).toHaveBeenCalledWith(["/changes"], { queryParams: { file: "b.ts", staged: null }, replaceUrl: true });
  });
});
