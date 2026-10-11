import { CdkContextMenuTrigger } from "@angular/cdk/menu";
import { ChangeDetectionStrategy, Component } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import type { Commit, Snapshot } from "../../../../contracts/model";
import { openRepository, settle } from "../../testing/component-harness";
import { CommitMenu } from "./commit-menu";
import type { NewRef, RefDialogOptions } from "./ref-dialog";

const COMMIT: Commit = {
  hash: "c".repeat(40),
  parents: ["p".repeat(40)],
  author: "Ann",
  email: "ann@example.com",
  date: "2026-01-01T00:00:00Z",
  subject: "Add things",
  refs: ["HEAD -> main", "feature", "origin/feature", "origin/HEAD", "tag: v1"],
};

@Component({
  imports: [CdkContextMenuTrigger, CommitMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <gd-commit-menu #commitMenu="gdCommitMenu" />
    <div class="row" tabindex="0" [cdkContextMenuTriggerFor]="commitMenu.menu()" [cdkContextMenuTriggerData]="{ $implicit: commit }">
      commit
    </div>
  `,
})
class Host {
  readonly commit = COMMIT;
}

const menuItems = () => [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container [role=menuitem]")];
const label = (item: HTMLElement) => item.textContent!.replace(/[\s›]+/g, " ").trim();
const named = (name: string) => menuItems().find((item) => label(item) === name);

async function rightClick(change: Partial<Snapshot> = {}) {
  const harness = await openRepository({
    branches: ["feature", "main"],
    remotes: [{ name: "origin", url: "https://github.com/acme/demo.git" }],
    tags: ["v1"],
    ...change,
  });
  const fixture = TestBed.createComponent(Host);
  await settle(fixture);
  const row = (fixture.nativeElement as HTMLElement).querySelector(".row")!;
  const contextMenu = async () => {
    row.dispatchEvent(new MouseEvent("contextmenu", { button: 2, clientX: 10, clientY: 10, cancelable: true, bubbles: true }));
    await settle(fixture);
  };
  await contextMenu();
  /** Chooses an entry, opening the menu again when needed. */
  const choose = async (name: string) => {
    if (!named(name)) await contextMenu();
    named(name)!.click();
    await settle(fixture);
  };
  return { ...harness, fixture, choose };
}

/** The ref dialog creates the ref with its answer before it closes. */
const answer = (dialogs: { open: ReturnType<typeof vi.fn> }, ref: NewRef) =>
  dialogs.open.mockImplementation(async (_: unknown, options: RefDialogOptions) => ((await options.accept?.(ref)) ? undefined : ref));

describe("CommitMenu", () => {
  afterEach(() => document.querySelector(".cdk-overlay-container")?.replaceChildren());

  it("offers branches and tags here, and acts on the refs pointing at the commit, without HEADs", async () => {
    await rightClick();
    expect(menuItems().map(label)).toEqual([
      "Create branch here…",
      "Create tag here…",
      "Cherry-pick onto main",
      "Revert…",
      "Rebase interactively from here…",
      "Rename main…",
      "Set upstream of main…",
      "Merge feature into main…",
      "Rebase main onto feature…",
      "Switch to feature",
      "Rename feature…",
      "Set upstream of feature…",
      "Delete feature…",
      "Merge origin/feature into main…",
      "Rebase main onto origin/feature…",
      "Delete origin/feature on the remote…",
      "Merge v1 into main…",
      "Rebase main onto v1…",
      "Push tag v1 to origin",
      "Delete tag v1…",
      "Delete tag v1 on origin…",
      "Copy GitDesk link",
      "Copy web link",
    ]);
  });

  it("creates a branch at the commit with the dialog's answer", async () => {
    const { dialogs, managers } = await rightClick();
    answer(dialogs, { name: "topic", checkout: false, message: "" });
    named("Create branch here…")!.click();
    await vi.waitFor(() => expect(managers.versionControl.createBranch).toHaveBeenCalledWith("w1", "topic", COMMIT.hash, false));
  });

  it("creates an annotated tag at the commit", async () => {
    const { dialogs, managers } = await rightClick();
    answer(dialogs, { name: "v2", checkout: true, message: "Notes" });
    named("Create tag here…")!.click();
    await vi.waitFor(() => expect(managers.versionControl.createTag).toHaveBeenCalledWith("w1", "v2", COMMIT.hash, "Notes"));
  });

  it("deletes an unmerged branch only after a second confirmation", async () => {
    const { dialogs, managers, choose } = await rightClick();
    managers.versionControl.deleteBranch.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await choose("Delete feature…");
    await vi.waitFor(() => expect(managers.versionControl.deleteBranch).toHaveBeenCalledWith("w1", "feature", true));
    expect(managers.versionControl.deleteBranch).toHaveBeenCalledWith("w1", "feature", false);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Branch not fully merged", danger: true }));
  });

  it("pushes and deletes tags on the remote after asking", async () => {
    const { dialogs, managers, choose } = await rightClick();
    await choose("Push tag v1 to origin");
    await vi.waitFor(() => expect(managers.versionControl.pushTag).toHaveBeenCalledWith("w1", "v1", "origin"));
    dialogs.confirm.mockResolvedValue(false);
    await choose("Delete tag v1 on origin…");
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Delete remote tag", danger: true }));
    expect(managers.versionControl.deleteRemoteTag).not.toHaveBeenCalled();
  });

  it("merges a branch into the current one", async () => {
    const { dialogs, managers, choose } = await rightClick();
    dialogs.open.mockResolvedValue({ noFastForward: true, message: "" });
    managers.versionControl.merge.mockResolvedValue("done");
    await choose("Merge origin/feature into main…");
    await vi.waitFor(() =>
      expect(managers.versionControl.merge).toHaveBeenCalledWith("w1", "origin/feature", { noFastForward: true, message: "" }),
    );
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), { source: "origin/feature", kind: "remote", target: "main" });
  });

  it("rebases onto a branch after warning that its commits were pushed", async () => {
    const { dialogs, managers, choose } = await rightClick({ changes: [{ path: "a.ts", index: " ", worktree: "M" }] });
    managers.versionControl.rebasePlan.mockResolvedValue({
      base: "b".repeat(40),
      commits: [{ hash: COMMIT.hash }],
      pushed: ["origin/main"],
    });
    managers.versionControl.rebase.mockResolvedValue("done");
    await choose("Rebase main onto feature…");
    await vi.waitFor(() => expect(managers.versionControl.rebase).toHaveBeenCalledWith("w1", "feature", true));
    const { message } = dialogs.confirm.mock.calls[0]![0] as { message: string };
    expect(message).toContain("force-push");
    expect(message).toContain("stashed meanwhile");
  });

  it("rebases interactively from the commit with the steps the dialog returns", async () => {
    const { dialogs, managers, choose } = await rightClick();
    const plan = { base: COMMIT.hash, commits: [{ hash: "d".repeat(40), merge: false }], pushed: [] };
    managers.versionControl.rebasePlan.mockResolvedValue(plan);
    const steps = [{ hash: "d".repeat(40), action: "drop" }];
    dialogs.open.mockResolvedValue(steps);
    await choose("Rebase interactively from here…");
    await vi.waitFor(() => expect(managers.versionControl.rebaseInteractive).toHaveBeenCalledWith("w1", COMMIT.hash, steps, false));
    expect(managers.versionControl.rebasePlan).toHaveBeenCalledWith("w1", COMMIT.hash);
  });

  it("cherry-picks a commit, and reverts it after asking", async () => {
    const { managers, choose } = await rightClick();
    await choose("Cherry-pick onto main");
    await vi.waitFor(() => expect(managers.versionControl.cherryPick).toHaveBeenCalledWith("w1", COMMIT.hash));
    await choose("Revert…");
    await vi.waitFor(() => expect(managers.versionControl.revert).toHaveBeenCalledWith("w1", COMMIT.hash));
  });

  it("deletes remote branches after asking", async () => {
    const { managers, choose } = await rightClick();
    await choose("Delete origin/feature on the remote…");
    await vi.waitFor(() => expect(managers.versionControl.deleteRemoteBranch).toHaveBeenCalledWith("w1", "origin/feature"));
  });
});
