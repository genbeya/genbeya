import { TestBed } from "@angular/core/testing";
import type { Change, Diff, LineSelection } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { snapshot } from "../../testing/fake-platform";
import { ChangesView } from "./changes-view";

async function render(changes: Change[]) {
  const harness = await openRepository({ changes });
  vi.spyOn(harness.router, "navigate").mockResolvedValue(true);
  harness.managers.versionControl.diff.mockResolvedValue({ path: "a.ts", original: "", modified: "x", binary: false, version: "v" });
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

  it("brings back the draft from before amending, unless the loaded message was edited", async () => {
    const { element, managers, fixture, typeMessage } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    managers.versionControl.lastCommitMessage.mockResolvedValue("Previous message");
    const amend = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    const toggle = async (checked: boolean) => {
      amend.checked = checked;
      amend.dispatchEvent(new Event("change"));
      await settle(fixture);
    };
    const message = () => element.querySelector("textarea")!.value;

    await toggle(true);
    expect(message()).toBe("Previous message");
    await toggle(false);
    expect(message()).toBe("");

    await typeMessage("Half-written message");
    await toggle(true);
    expect(message()).toBe("Half-written message");
    await toggle(false);
    expect(message()).toBe("Half-written message");

    await typeMessage("");
    await toggle(true);
    await typeMessage("Previous message, reworded");
    await toggle(false);
    expect(message()).toBe("Previous message, reworded");
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
    // The dialog loads lazily.
    await vi.waitFor(() => expect(managers.versionControl.stash).toHaveBeenCalledWith("w1", options));
  });

  it("lists stashes and shows the selected one with its files", async () => {
    const stash = { hash: "a".repeat(40), index: 0, message: "Half done", branch: "main", date: new Date().toISOString() };
    const harness = await openRepository({ stashes: [stash] });
    harness.managers.versionControl.stashDetail.mockResolvedValue({
      stash,
      files: [{ status: "M", path: "a.ts", commit: stash.hash }],
    });
    harness.managers.versionControl.diff.mockResolvedValue({ path: "a.ts", original: "", modified: "x", binary: false, version: "v" });
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
    // A stash made without a message has none to show.
    const stash = { hash: "b".repeat(40), index: 2, message: "", branch: null, date: new Date().toISOString() };
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
    expect(harness.dialogs.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Drop stash", message: "Drop stash@{2}? Its changes are lost.", danger: true }),
    );
    expect(harness.managers.versionControl.dropStash).not.toHaveBeenCalled();
  });

  it("lists conflicts on their own and selects the first one", async () => {
    const { element, router, managers } = await render([
      { path: "a.ts", index: "U", worktree: "U", conflict: "both-modified" },
      { path: "b.ts", index: "M", worktree: " " },
    ]);
    managers.versionControl.conflict.mockResolvedValue({ path: "a.ts", kind: "both-modified", text: "" });
    expect(element.querySelector("[aria-label='Conflicts']")!.textContent).toContain("changed on both sides");
    expect(element.querySelector("[aria-label='Staged changes']")!.textContent).not.toContain("a.ts");
    expect(router.navigate).toHaveBeenCalledWith(["/changes"], { queryParams: { conflict: "a.ts" }, replaceUrl: true });
  });

  it("shows the changes in their folders when asked, and remembers it", async () => {
    const { element, fixture } = await render([
      { path: "src/a.ts", index: "M", worktree: " " },
      { path: "src/b.ts", index: " ", worktree: "M" },
    ]);
    expect(element.querySelector("gd-change-tree")).toBeNull();
    element.querySelector<HTMLButtonElement>("[aria-label='Show as tree']")!.click();
    await settle(fixture);
    expect([...element.querySelectorAll("gd-change-tree")].map((tree) => tree.getAttribute("aria-label"))).toEqual([
      "Staged changes",
      "Changes",
    ]);
    expect(localStorage.getItem("changes:tree")).toBe("1");
    element.querySelector<HTMLButtonElement>("[aria-label='Show as list']")!.click();
    await settle(fixture);
    expect(localStorage.getItem("changes:tree")).toBe("0");
    localStorage.removeItem("changes:tree");
  });

  it("compares with the parent while amending, unstages from it and warns about pushed commits", async () => {
    const { element, managers, fixture, session } = await render([{ path: "a.ts", index: " ", worktree: "M" }]);
    managers.versionControl.lastCommitMessage.mockResolvedValue("Previous message");
    managers.workspace.snapshot.mockResolvedValue(
      snapshot({
        version: "v2",
        changes: [{ path: "b.ts", index: "A", worktree: " " }],
        amending: { commit: "abc1234", parent: "def5678", merge: true, pushed: ["origin/main"] },
      }),
    );
    const amend = element.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    amend.checked = true;
    amend.dispatchEvent(new Event("change"));
    await settle(fixture);
    expect(managers.workspace.snapshot).toHaveBeenCalledWith("w1", "v1", "parent");
    expect(session.changeBase()).toBe("parent");
    const box = element.querySelector(".commit-box")!.textContent!;
    expect(box).toContain("The changes of abc1234 are staged");
    expect(box).toContain("It is a merge");
    expect(element.querySelector(".amend-warning")!.textContent).toContain("abc1234 is already on origin/main");
    element.querySelector<HTMLButtonElement>("[aria-label='Staged changes'] gd-change-row [aria-label='Unstage']")!.click();
    await settle(fixture);
    expect(managers.versionControl.unstage).toHaveBeenCalledWith("w1", ["b.ts"], "parent");
    amend.checked = false;
    amend.dispatchEvent(new Event("change"));
    await settle(fixture);
    expect(session.changeBase()).toBe("head");
  });

  it("cannot amend before the first commit", async () => {
    const harness = await openRepository({ head: { branch: "main", commit: null, upstream: null, ahead: 0, behind: 0 } });
    const fixture = TestBed.createComponent(ChangesView);
    await settle(fixture);
    expect((fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>("input[type=checkbox]")!.disabled).toBe(true);
    expect(harness.session.changeBase()).toBe("head");
  });

  it("stages, unstages and discards lines of the diff it shows, asking before discarding", async () => {
    const { fixture, managers, dialogs, session } = await render([{ path: "a.ts", oldPath: "old.ts", index: "R", worktree: "M" }]);
    const view = fixture.componentInstance as unknown as {
      applyLines(action: string, lines: LineSelection, diff: Diff, hunk: boolean): Promise<boolean>;
    };
    fixture.componentRef.setInput("file", "a.ts");
    const lines: LineSelection = { original: [{ from: 2, to: 2 }], modified: [] };
    const diff: Diff = { path: "a.ts", original: "", modified: "", binary: false, version: "v" };
    expect(await view.applyLines("stage", lines, diff, false)).toBe(true);
    expect(managers.versionControl.stageLines).toHaveBeenCalledWith("w1", { path: "a.ts", version: "v", lines });
    dialogs.confirm.mockResolvedValueOnce(false);
    expect(await view.applyLines("discard", lines, diff, true)).toBe(false);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Discard change", danger: true }));
    expect(managers.versionControl.discardLines).not.toHaveBeenCalled();
    await view.applyLines("discard", lines, diff, false);
    expect(managers.versionControl.discardLines).toHaveBeenCalledWith("w1", { path: "a.ts", version: "v", lines });
    await session.compareWith("parent");
    await view.applyLines("unstage", lines, diff, false);
    expect(managers.versionControl.unstageLines).toHaveBeenCalledWith(
      "w1",
      { path: "a.ts", oldPath: "old.ts", version: "v", lines },
      "parent",
    );
  });

  it("ignores a file from its context menu", async () => {
    const { element, fixture, dialogs, managers } = await render([{ path: "logs/out.log", index: "?", worktree: "?" }]);
    dialogs.open.mockResolvedValue({ location: "logs", untrack: false });
    element.querySelector("gd-change-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    await settle(fixture);
    const items = [...document.querySelectorAll<HTMLButtonElement>(".menu-item")];
    expect(items.map((item) => item.textContent!.trim())).toEqual([
      "Stage",
      "Discard changes…",
      "Open file",
      "Ignore file out.log…",
      "Ignore folder logs…",
      "Ignore all *.log files…",
    ]);
    items[5]!.click();
    await vi.waitFor(() => expect(managers.versionControl.ignore).toHaveBeenCalledWith("w1", "logs/out.log", "extension", "logs"));
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), { path: "logs/out.log", kind: "extension", tracked: false });
    expect(managers.versionControl.untrack).not.toHaveBeenCalled();
  });

  it("offers to stop tracking files Git tracks", async () => {
    const { element, fixture, dialogs, managers } = await render([{ path: "build.js", index: " ", worktree: "M" }]);
    element.querySelector("gd-change-row")!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    await settle(fixture);
    [...document.querySelectorAll<HTMLButtonElement>(".menu-item")].find((item) => item.textContent!.includes("Stop tracking"))!.click();
    await settle(fixture);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Stop tracking", danger: true }));
    expect(managers.versionControl.untrack).toHaveBeenCalledWith("w1", ["build.js"]);
  });

  it("selects the first change", async () => {
    const { router } = await render([{ path: "b.ts", index: " ", worktree: "M" }]);
    expect(router.navigate).toHaveBeenCalledWith(["/changes"], { queryParams: { file: "b.ts", staged: null }, replaceUrl: true });
  });
});
