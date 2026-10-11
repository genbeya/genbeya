import { TestBed } from "@angular/core/testing";
import type { ForcePushPlan, Snapshot } from "../../../../contracts/model";
import { Notifications } from "../../core/notifications";
import { openRepository, settle } from "../../testing/component-harness";
import { snapshot } from "../../testing/fake-platform";
import { SyncBar } from "./sync-bar";

const ORIGIN = { name: "origin", url: "https://example.com/repo.git" };
const TRACKING = { head: { ...snapshot().head, upstream: "origin/main" } };

async function render(change: Partial<Snapshot>) {
  const harness = await openRepository(change);
  const fixture = TestBed.createComponent(SyncBar);
  await settle(fixture);
  const element = fixture.nativeElement as HTMLElement;
  const button = (name: string) =>
    [...element.querySelectorAll("button")].find(
      (candidate) => (candidate.getAttribute("aria-label") ?? candidate.textContent!.trim()) === name,
    )!;
  const click = async (name: string) => {
    button(name).click();
    await settle(fixture);
  };
  /** Opens the menu and chooses an entry. */
  const choose = async (name: string) => {
    await click("More sync actions");
    [...document.querySelectorAll<HTMLElement>(".cdk-overlay-container [role=menuitem]")]
      .find((item) => item.textContent!.trim() === name)!
      .click();
    await settle(fixture);
  };
  const notifications = TestBed.inject(Notifications);
  return {
    ...harness,
    element,
    fixture,
    button,
    click,
    choose,
    notifications,
    labels: () => [...element.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") ?? b.textContent!.trim()),
  };
}

describe("SyncBar", () => {
  afterEach(() => document.querySelector(".cdk-overlay-container")?.replaceChildren());

  it("fetches, pulls and pushes a branch with an upstream", async () => {
    const { labels, click, managers } = await render({ remotes: [ORIGIN], ...TRACKING });
    expect(labels()).toEqual(["Fetch from origin", "Pull from origin", "Push to origin", "More sync actions"]);
    managers.versionControl.push.mockResolvedValue("done");
    await click("Push to origin");
    expect(managers.versionControl.push).toHaveBeenCalledWith("w1", {
      branch: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: false,
    });
  });

  it("offers nothing to sync without a remote, and says so", async () => {
    const { element, labels } = await render({ remotes: [] });
    expect(labels()).toEqual(["More sync actions"]);
    expect(element.textContent).toContain("no remote");
  });

  it("publishes a branch without upstream to origin, tracking the branch there", async () => {
    const backup = { name: "backup", url: "/srv/backup.git" };
    const { labels, click, managers, notifications } = await render({ remotes: [backup, ORIGIN] });
    expect(labels()).toContain("Publish branch");
    managers.versionControl.push.mockResolvedValue("done");
    await click("Publish branch");
    expect(managers.versionControl.push).toHaveBeenCalledWith("w1", {
      branch: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: true,
    });
    expect(notifications.visible().map((n) => n.message)).toEqual(["Published main to origin"]);
  });

  it("asks where to publish when no remote is the obvious one", async () => {
    const remotes = [
      { name: "backup", url: "/srv/backup.git" },
      { name: "mirror", url: "/srv/mirror.git" },
    ];
    const { click, managers, dialogs } = await render({ remotes });
    const plan = { branch: "main", upstream: null, remotes: [] };
    managers.versionControl.pushPlan.mockResolvedValue({ ...plan, remotes: [{ remote: "mirror", defaultBranch: null, branches: [] }] });
    dialogs.open.mockResolvedValue({ remote: "mirror", remoteBranch: "trunk", setUpstream: true, force: false });
    managers.versionControl.push.mockResolvedValue("done");
    await click("Publish branch");
    await vi.waitFor(() =>
      expect(managers.versionControl.push).toHaveBeenCalledWith("w1", {
        branch: "main",
        remote: "mirror",
        remoteBranch: "trunk",
        setUpstream: true,
      }),
    );
  });

  it("offers a force push with lease when the remote rejects the push, after showing what it removes", async () => {
    const { click, managers, notifications, dialogs } = await render({ remotes: [ORIGIN], ...TRACKING });
    managers.versionControl.push.mockResolvedValueOnce("rejected").mockResolvedValueOnce("done");
    await click("Push to origin");
    const [rejection] = notifications.visible();
    expect(rejection).toMatchObject({ kind: "error", action: { label: "Force push with lease…" } });
    expect(rejection!.message).toContain("origin/main has commits that main lacks");

    const plan: ForcePushPlan = { expected: "e".repeat(40), removed: [], total: 0, defaultBranch: true };
    managers.versionControl.forcePushPlan.mockResolvedValue(plan);
    dialogs.open.mockResolvedValue({ defaultBranch: true });
    notifications.act(rejection!);
    await vi.waitFor(() =>
      expect(managers.versionControl.push).toHaveBeenLastCalledWith("w1", {
        branch: "main",
        remote: "origin",
        remoteBranch: "main",
        setUpstream: false,
        force: { expected: plan.expected, defaultBranch: true },
      }),
    );
    expect(managers.versionControl.forcePushPlan).toHaveBeenCalledWith("w1", "main", "origin", "main");
    expect(dialogs.open).toHaveBeenCalledWith(expect.anything(), { plan, branch: "main", remote: "origin", remoteBranch: "main" });
    expect(notifications.visible().map((n) => n.message)).toEqual(["Force pushed main to origin/main"]);
  });

  it("undoes the last commit and redoes it", async () => {
    const { choose, managers, notifications, dialogs } = await render({ remotes: [ORIGIN] });
    const result = { from: "b".repeat(40), to: "a".repeat(40) };
    managers.versionControl.undoLastCommit.mockResolvedValue(result);
    await choose("Undo last commit");
    expect(managers.versionControl.undoLastCommit).toHaveBeenCalledWith("w1");
    expect(dialogs.confirm).not.toHaveBeenCalled();
    const [done] = notifications.visible();
    expect(done).toMatchObject({ message: "Undid the last commit; its changes are staged", action: { label: "Redo" } });
    notifications.act(done!);
    await vi.waitFor(() => expect(managers.versionControl.reset).toHaveBeenCalledWith("w1", result.from, "soft", result.to));
  });

  it("asks before undoing a commit the upstream has", async () => {
    const { choose, managers, dialogs } = await render({ remotes: [ORIGIN], ...TRACKING });
    dialogs.confirm.mockResolvedValue(false);
    await choose("Undo last commit");
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Undo a pushed commit" }));
    expect(managers.versionControl.undoLastCommit).not.toHaveBeenCalled();
  });
});
