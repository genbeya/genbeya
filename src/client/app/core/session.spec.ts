import { TestBed } from "@angular/core/testing";
import { launchArgument } from "../../../utilities/launch-request";
import { contentBranch, fakeManagers, fakeShell, providePlatform, snapshot } from "../testing/fake-platform";
import { Dialogs } from "./dialogs";
import { Notifications } from "./notifications";
import { Session } from "./session";
import { UnsavedChanges } from "./unsaved-changes";
import { WorkspaceApi } from "./workspace-api";

function setup() {
  const managers = fakeManagers();
  const shell = fakeShell();
  const dialogs = { confirm: vi.fn(async () => true) };
  TestBed.configureTestingModule({ providers: [...providePlatform(managers, shell), { provide: Dialogs, useValue: dialogs }] });
  return { managers, shell, dialogs, session: TestBed.inject(Session), notifications: TestBed.inject(Notifications) };
}

describe("Session", () => {
  it("restores the repository the launch asks for and names the window", async () => {
    const { session, managers, shell } = setup();
    shell.launchArgs.mockResolvedValue(["app", "--open=x"]);
    managers.workspace.restore.mockResolvedValue({ id: "w1", snapshot: snapshot() });
    await session.start();
    expect(managers.workspace.restore).toHaveBeenCalledWith(["app", "--open=x"]);
    expect(session.id()).toBe("w1");
    expect(session.phase()).toBe("idle");
    expect(shell.setTitle).toHaveBeenCalledWith("Test Project — GitDesk");
  });

  it("stays on the welcome screen when nothing can be restored", async () => {
    const { session } = setup();
    await session.start();
    expect(session.snapshot()).toBeNull();
  });

  it("opens a picked folder", async () => {
    const { session, managers, shell } = setup();
    shell.pickFolder.mockResolvedValue({ kind: "local", path: "/repo" });
    await session.pick();
    expect(managers.workspace.open).toHaveBeenCalledWith({ kind: "local", path: "/repo" });
    expect(session.snapshot()?.settings.name).toBe("Test Project");
  });

  it("does nothing when the picker is cancelled", async () => {
    const { session, managers } = setup();
    await session.pick();
    expect(managers.workspace.open).not.toHaveBeenCalled();
  });

  it("reports failures to open and returns to idle", async () => {
    const { session, managers, notifications } = setup();
    managers.workspace.open.mockRejectedValue(new Error("This folder is not inside a Git repository."));
    await session.open({ kind: "local", path: "/x" });
    expect(notifications.visible()[0]?.message).toBe("This folder is not inside a Git repository.");
    expect(session.phase()).toBe("idle");
  });

  it("asks before discarding unsaved edits when switching repositories", async () => {
    const { session, managers, dialogs } = setup();
    TestBed.inject(UnsavedChanges).mark({}, true);
    dialogs.confirm.mockResolvedValue(false);
    await session.open({ kind: "local", path: "/repo" });
    expect(managers.workspace.open).not.toHaveBeenCalled();
    dialogs.confirm.mockResolvedValue(true);
    await session.open({ kind: "local", path: "/repo" });
    expect(managers.workspace.open).toHaveBeenCalled();
  });

  it("keeps tracking unsaved edits when the switch does not happen", async () => {
    const { session, managers } = setup();
    const unsaved = TestBed.inject(UnsavedChanges);
    unsaved.mark({}, true);
    managers.workspace.open.mockRejectedValue(new Error("Not a repository."));
    await session.open({ kind: "local", path: "/x" });
    expect(unsaved.any()).toBe(true);
  });

  it("lets the user pick a folder before asking about unsaved edits", async () => {
    const { session, dialogs } = setup();
    TestBed.inject(UnsavedChanges).mark({}, true);
    await session.pick();
    expect(dialogs.confirm).not.toHaveBeenCalled();
  });

  it("ignores a snapshot that a newer refresh overtook", async () => {
    const { session, managers } = setup();
    await session.open({ kind: "local", path: "/repo" });
    let answerOld!: (value: unknown) => void;
    managers.workspace.snapshot.mockReturnValueOnce(new Promise((resolve) => (answerOld = resolve)));
    managers.workspace.snapshot.mockResolvedValueOnce(snapshot({ version: "v3" }));
    const old = session.refresh();
    await session.refresh();
    answerOld(snapshot({ version: "v2" }));
    await old;
    expect(session.snapshot()?.version).toBe("v3");
  });

  it("closes the repository", async () => {
    const { session, managers } = setup();
    await session.open({ kind: "local", path: "/repo" });
    await session.close();
    expect(managers.workspace.close).toHaveBeenCalledWith("w1");
    expect(session.snapshot()).toBeNull();
  });

  it("refreshes only when the snapshot changed", async () => {
    const { session, managers } = setup();
    await session.open({ kind: "local", path: "/repo" });
    await session.refresh();
    expect(managers.workspace.snapshot).toHaveBeenCalledWith("w1", "v1");
    managers.workspace.snapshot.mockResolvedValue(snapshot({ version: "v2", tasks: [] }));
    await session.refresh();
    expect(session.snapshot()?.version).toBe("v2");
  });

  it("runs actions, reports results and refreshes", async () => {
    const { session, notifications, managers } = setup();
    await session.open({ kind: "local", path: "/repo" });
    expect(await session.run(async () => 42, "Done")).toBe(42);
    expect(await session.run(() => Promise.reject(new Error("Nope")))).toBeUndefined();
    expect(notifications.visible().map((n) => n.message)).toEqual(["Done", "Nope"]);
    expect(managers.workspace.snapshot).toHaveBeenCalledTimes(2);
    expect(session.busy()).toBe(false);
  });

  it("syncs content edits shortly after when the content branch syncs automatically", async () => {
    vi.useFakeTimers();
    const { session, managers } = setup();
    managers.workspace.open.mockResolvedValue({
      id: "w1",
      snapshot: snapshot({ storage: contentBranch(["tasks"], { ahead: 1 }) }),
    });
    managers.workspace.setPreferences.mockResolvedValue({ theme: "system", reopenLast: true, autoSyncContent: true });
    await session.open({ kind: "local", path: "/repo" });
    await session.setPreferences({ autoSyncContent: true });
    session.contentChanged();
    session.contentChanged();
    await vi.advanceTimersByTimeAsync(3000);
    expect(managers.content.syncContent).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("leaves a content branch that holds no area and nothing to push alone", async () => {
    vi.useFakeTimers();
    const { session, managers } = setup();
    managers.workspace.open.mockResolvedValue({ id: "w1", snapshot: snapshot({ storage: contentBranch([]) }) });
    managers.workspace.setPreferences.mockResolvedValue({ theme: "system", reopenLast: true, autoSyncContent: true });
    await session.open({ kind: "local", path: "/repo" });
    await session.setPreferences({ autoSyncContent: true });
    session.contentChanged();
    await vi.advanceTimersByTimeAsync(3000);
    expect(managers.content.syncContent).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("opens the repository a second launch asks for", async () => {
    const { managers, shell } = setup();
    TestBed.inject(Session);
    const listener = shell.onSecondLaunch.mock.calls[0]![0] as (args: string[]) => void;
    listener(["app", launchArgument({ kind: "local", path: "/other" })]);
    await vi.waitFor(() => expect(managers.workspace.open).toHaveBeenCalledWith({ kind: "local", path: "/other" }));
  });

  it("holds GitDesk links that launches carry until they are taken", async () => {
    const { session, managers, shell } = setup();
    const link = "gitdesk://open?remote=https://github.com/acme/demo.git&task=TP-1";
    const expected = { remote: "https://github.com/acme/demo.git", item: { kind: "task", id: "TP-1" } };
    shell.launchArgs.mockResolvedValue(["app", link]);
    await session.start();
    expect(managers.workspace.restore).toHaveBeenCalledWith(["app", link]);
    expect(session.requestedLink()).toEqual(expected);
    expect(session.takeRequestedLink()).toEqual(expected);
    expect(session.requestedLink()).toBeNull();

    const secondLaunch = shell.onSecondLaunch.mock.calls[0]![0] as (args: string[]) => void;
    secondLaunch(["app", link.replace("task=TP-1", "page=docs/Home.md")]);
    expect(session.takeRequestedLink()?.item).toEqual({ kind: "page", path: "docs/Home.md" });
    expect(managers.workspace.open).not.toHaveBeenCalled();
  });

  it("guards closing the window with unsaved changes", () => {
    const { shell } = setup();
    const unsaved = TestBed.inject(UnsavedChanges);
    const hasUnsaved = shell.guardClose.mock.calls[0]![0] as () => boolean;
    expect(hasUnsaved()).toBe(false);
    unsaved.mark({}, true);
    expect(hasUnsaved()).toBe(true);
  });
});

describe("WorkspaceApi", () => {
  it("passes the open repository's id to every call", async () => {
    const { session, managers } = setup();
    const api = TestBed.inject(WorkspaceApi);
    await expect(api.content.read("repo", "a.md")).rejects.toThrow("No repository is open.");
    await session.open({ kind: "local", path: "/repo" });
    await api.content.read("repo", "a.md");
    await api.versionControl.stage(["a.md"]);
    expect(managers.content.read).toHaveBeenCalledWith("w1", "repo", "a.md");
    expect(managers.versionControl.stage).toHaveBeenCalledWith("w1", ["a.md"]);
  });
});
