import { describe, expect, it, vi } from "vitest";
import { RepositoryAccess } from "../access/git/repository-access";
import type { Host } from "../access/hosts/host";
import { SettingsEngine } from "../engines/settings-engine";
import { TaskEngine } from "../engines/task-engine";
import { posixPaths } from "../utilities/native-path";
import { Workspace, WorkspaceRegistry } from "./workspace";

/** A workspace whose host only counts disconnects. */
function workspace() {
  const host = { paths: posixPaths, dispose: vi.fn() } as unknown as Host & { dispose: ReturnType<typeof vi.fn> };
  const opened = new Workspace({ kind: "ssh", host: "server", path: "/repo" }, host, new RepositoryAccess(host, "/repo"), {
    settings: new SettingsEngine(),
    tasks: new TaskEngine(),
  });
  return { host, workspace: opened };
}

/** An operation that runs until `finish` is called. */
function blocking() {
  let finish!: () => void;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return { finish, operation: () => done };
}

describe("WorkspaceRegistry", () => {
  it("lets running operations finish before disconnecting a closed repository", async () => {
    const registry = new WorkspaceRegistry();
    const { host, workspace: opened } = workspace();
    const id = registry.activate(opened);
    const { finish, operation } = blocking();
    const running = opened.exclusive(operation);

    const closed = registry.close(id);
    expect(() => registry.get(id)).toThrow("This repository is no longer open.");
    await expect(opened.exclusive(async () => "late")).rejects.toThrow("This repository is no longer open.");
    expect(host.dispose).not.toHaveBeenCalled();

    finish();
    await running;
    await closed;
    expect(host.dispose).toHaveBeenCalledOnce();
  });

  it("closes the other repositories after their work when another opens", async () => {
    const registry = new WorkspaceRegistry();
    const first = workspace();
    const second = workspace();
    registry.activate(first.workspace);
    const { finish, operation } = blocking();
    const running = first.workspace.exclusive(operation);
    registry.activate(second.workspace);
    expect(registry.current()).toBe(second.workspace);
    expect(first.host.dispose).not.toHaveBeenCalled();
    finish();
    await running;
    await registry.closeAll();
    expect(first.host.dispose).toHaveBeenCalledOnce();
    expect(second.host.dispose).toHaveBeenCalledOnce();
  });

  it("cuts off operations that outlast the grace period when closing everything", async () => {
    const registry = new WorkspaceRegistry();
    const { host, workspace: opened } = workspace();
    registry.activate(opened);
    void opened.exclusive(blocking().operation);
    await registry.closeAll(50);
    expect(host.dispose).toHaveBeenCalled();
  });
});

describe("Workspace", () => {
  it("tells its listeners right away when it closes, without waiting for running operations", async () => {
    const registry = new WorkspaceRegistry();
    const { workspace: opened } = workspace();
    const id = registry.activate(opened);
    const closing = vi.fn();
    const forgotten = vi.fn();
    opened.onClose(closing);
    opened.onClose(forgotten)();
    void opened.exclusive(blocking().operation);
    void registry.close(id);
    expect(closing).toHaveBeenCalledOnce();
    expect(forgotten).not.toHaveBeenCalled();
    opened.dispose();
    expect(closing).toHaveBeenCalledOnce();
  });

  it("calls a listener at once when it is closed already", () => {
    const { workspace: opened } = workspace();
    opened.dispose();
    const closing = vi.fn();
    opened.onClose(closing);
    expect(closing).toHaveBeenCalledOnce();
  });
});
