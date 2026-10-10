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

  it("keeps the message while the user looks at another view", async () => {
    const { fixture, typeMessage } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    await typeMessage("Half-written message");
    fixture.destroy();
    const again = TestBed.createComponent(ChangesView);
    await settle(again);
    expect((again.nativeElement as HTMLElement).querySelector("textarea")!.value).toBe("Half-written message");
  });

  it("does not overwrite what the user typed while the last message loads", async () => {
    const { element, managers, fixture, typeMessage } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    let answer!: (message: string) => void;
    managers.versionControl.lastCommitMessage.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const amend = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    amend.checked = true;
    amend.dispatchEvent(new Event("change"));
    await typeMessage("Typed meanwhile");
    answer("Previous message");
    await settle(fixture);
    expect(element.querySelector("textarea")!.value).toBe("Typed meanwhile");
  });

  it("asks before discarding changes", async () => {
    const { fixture, dialogs, managers } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    dialogs.confirm.mockResolvedValue(false);
    (fixture.componentInstance as unknown as { discard(paths: string[]): Promise<void> }).discard(["a.ts"]);
    await settle(fixture);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Discard changes", danger: true }));
    expect(managers.versionControl.discard).not.toHaveBeenCalled();
  });

  it("stashes changes with the options the dialog returns", async () => {
    const { element, dialogs, managers, fixture } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    const options = { message: "Later", includeUntracked: true, keepIndex: false };
    dialogs.open.mockResolvedValue(options);
    element.querySelector<HTMLButtonElement>("[aria-label='Stash changes']")!.click();
    await settle(fixture);
    expect(managers.versionControl.stash).toHaveBeenCalledWith("w1", options);
  });

  it("lists stashes and shows the selected one with its files", async () => {
    const stash = { hash: "a".repeat(40), index: 0, message: "Half done", branch: "main", date: new Date().toISOString() };
    const harness = await openRepository({ stashes: [stash] });
    harness.managers.versionControl.stashDetail.mockResolvedValue({
      stash,
      files: [{ status: "M", path: "a.ts", commit: stash.hash }],
    });
    harness.managers.versionControl.diff.mockResolvedValue({ path: "a.ts", original: "", modified: "x", binary: false });
    const navigate = vi.spyOn(harness.router, "navigate").mockResolvedValue(true);
    const fixture = TestBed.createComponent(ChangesView);
    fixture.componentRef.setInput("stash", stash.hash);
    await settle(fixture);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector("[aria-label='Stashes']")!.textContent).toContain("Half done");
    expect(element.querySelector("gd-stash-pane h2")!.textContent).toBe("Half done");
    expect(navigate).toHaveBeenCalledWith(["/changes"], { queryParams: { stash: stash.hash, file: "a.ts" }, replaceUrl: true });

    harness.managers.versionControl.applyStash.mockResolvedValue("done");
    [...element.querySelectorAll<HTMLButtonElement>("gd-stash-pane button")].find((b) => b.textContent!.includes("Pop"))!.click();
    await settle(fixture);
    expect(harness.managers.versionControl.applyStash).toHaveBeenCalledWith("w1", stash.hash, true);
  });

  it("asks before dropping a stash", async () => {
    const stash = { hash: "b".repeat(40), index: 0, message: "Old", branch: null, date: new Date().toISOString() };
    const harness = await openRepository({ stashes: [stash] });
    harness.managers.versionControl.stashDetail.mockResolvedValue({ stash, files: [] });
    harness.dialogs.confirm.mockResolvedValue(false);
    const fixture = TestBed.createComponent(ChangesView);
    fixture.componentRef.setInput("stash", stash.hash);
    await settle(fixture);
    const drop = [...(fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>("gd-stash-pane button")].find((b) =>
      b.textContent!.includes("Drop"),
    )!;
    drop.click();
    await settle(fixture);
    expect(harness.dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Drop stash", danger: true }));
    expect(harness.managers.versionControl.dropStash).not.toHaveBeenCalled();
  });

  it("selects the first change", async () => {
    const { router } = await render([{ path: "b.ts", index: " ", worktree: "M" }]);
    expect(router.navigate).toHaveBeenCalledWith(["/changes"], { queryParams: { file: "b.ts", staged: null }, replaceUrl: true });
  });
});
