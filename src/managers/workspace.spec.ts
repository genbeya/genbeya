import { describe, expect, it, vi } from "vitest";
import { RepositoryAccess } from "../access/git/repository-access";
import type { Host } from "../access/hosts/host";
import { LocalHost } from "../access/hosts/local-host";
import { SettingsEngine } from "../engines/settings-engine";
import { TaskEngine } from "../engines/task-engine";
import { nodeMachine } from "../platforms/node/node-machine";
import { createRepository, DEFAULT_FILES } from "../testing/repository";
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

  it("hands an open repository over to a new client under a new id", () => {
    const registry = new WorkspaceRegistry();
    const { host, workspace: opened } = workspace();
    const first = registry.activate(opened);
    const released = vi.fn();
    opened.onRelease(released);
    const second = registry.activate(opened);
    expect(released).toHaveBeenCalledOnce();
    expect(() => registry.get(first)).toThrow("This repository is no longer open.");
    expect(registry.get(second)).toBe(opened);
    expect(host.dispose).not.toHaveBeenCalled();
  });
});

describe("Workspace", () => {
  it("tells its listeners right away when it closes, without waiting for running operations", async () => {
    const registry = new WorkspaceRegistry();
    const { workspace: opened } = workspace();
    const id = registry.activate(opened);
    const closing = vi.fn();
    const forgotten = vi.fn();
    opened.onRelease(closing);
    opened.onRelease(forgotten)();
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
    opened.onRelease(closing);
    expect(closing).toHaveBeenCalledOnce();
  });

  it("finds where a content path lives by its area", async () => {
    const repository = await createRepository({ ...DEFAULT_FILES, ".genbeya.yml": "name: Test\ntaskRoot: work\n" });
    const host = new LocalHost(nodeMachine());
    const root = host.paths.normalize(repository.root);
    const opened = new Workspace({ kind: "local", path: root }, host, new RepositoryAccess(host, root), {
      settings: new SettingsEngine(),
      tasks: new TaskEngine(),
    });
    await opened.content.setStorage("tasks", "branch", "work");

    expect(await opened.areaOf(".genbeya.yml")).toBe("settings");
    expect(await opened.areaOf(".gitdesk.yml")).toBe("settings");
    expect(await opened.areaOf("work/Epic/T-1.md")).toBe("tasks");
    expect(await opened.areaOf("docs/Home.md")).toBe("wiki");
    expect(await opened.areaOf("images/logo.png")).toBe("wiki");
    expect((await opened.locateContent("work/T-1.md")).branch).toBe("genbeya");
    expect(await opened.locateContent("docs/Home.md")).toMatchObject({ branch: null, root });
  });
});

describe("Workspace settings", () => {
  /** A workspace on a repository with `files` besides the wiki. */
  async function open(files: Readonly<Record<string, string>>) {
    const repository = await createRepository({ "docs/Home.md": "# Home\n", ...files });
    const host = new LocalHost(nodeMachine());
    const root = host.paths.normalize(repository.root);
    return new Workspace({ kind: "local", path: root }, host, new RepositoryAccess(host, root), {
      settings: new SettingsEngine(),
      tasks: new TaskEngine(),
    });
  }

  it("reads .genbeya.yml", async () => {
    const loaded = await (await open({ ".genbeya.yml": "name: New\n" })).settings();
    expect(loaded).toMatchObject({ settings: { name: "New" }, file: ".genbeya.yml", leftover: null });
    expect(loaded.hash).not.toBeNull();
  });

  it("reads .gitdesk.yml in a repository GitDesk set up", async () => {
    const opened = await open({ ".gitdesk.yml": "name: Old\ntaskPrefix: OLD\n" });
    expect(await opened.settings()).toMatchObject({ settings: { name: "Old", taskPrefix: "OLD" }, file: ".gitdesk.yml", leftover: null });
  });

  it("prefers .genbeya.yml and names .gitdesk.yml next to it as left over", async () => {
    const opened = await open({ ".genbeya.yml": "name: New\n", ".gitdesk.yml": "name: Old\n" });
    expect(await opened.settings()).toMatchObject({ settings: { name: "New" }, file: ".genbeya.yml", leftover: ".gitdesk.yml" });
  });

  it("starts with defaults and .genbeya.yml in a repository without settings", async () => {
    expect(await (await open({})).settings()).toMatchObject({ file: ".genbeya.yml", leftover: null, hash: null });
  });

  it("names the broken file it falls back from", async () => {
    const { problem } = await (await open({ ".gitdesk.yml": "name: [\n" })).settings();
    expect(problem).toMatch(/^\.gitdesk\.yml: [\s\S]* Using defaults until it is fixed\.$/);
  });
});
