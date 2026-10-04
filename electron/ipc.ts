import { randomUUID } from "node:crypto";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain, nativeTheme, net, shell, type IpcMainInvokeEvent } from "electron";
import type { Location, WorkspaceAPI } from "../shared/api.js";
import { createHost, fromWindowsPath, validateLocation, wslDistros } from "../core/hosts.js";
import { Workspace } from "../core/workspace.js";
import { locationFromArgs, updateJumpList } from "./jumplist.js";
import { renderPlantUml } from "./plantuml.js";
import type { Store } from "./state.js";

const WORKSPACE_METHODS: (keyof WorkspaceAPI)[] = [
  "snapshot", "read", "image", "write", "remove", "createPage", "movePage", "deletePage", "createTask",
  "updateTask", "deleteTask", "diff", "stage", "unstage", "discard", "commit",
  "lastCommitMessage", "log", "commitDetail", "switchBranch", "createBranch", "sync",
  "setRemote", "removeRemote", "saveSettings", "setStorage", "syncContent",
];

/**
 * Validated IPC between the renderer and the open workspace. Every request
 * names the workspace it was issued for, so calls racing a repository switch
 * fail instead of touching the newly opened repository.
 */
export function registerIpc(window: BrowserWindow, store: Store, rendererOrigin: (url: URL) => boolean) {
  let workspace: Workspace | null = null;
  let token: string | null = null;

  const trusted = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
      throw new Error("Untrusted IPC sender.");
    if (!rendererOrigin(new URL(event.senderFrame?.url ?? "about:blank")))
      throw new Error("Untrusted renderer URL.");
  };

  const handle = (channel: string, fn: (...args: any[]) => unknown) =>
    ipcMain.handle(channel, async (event, ...args) => {
      trusted(event);
      return fn(...args);
    });

  for (const method of WORKSPACE_METHODS)
    handle("workspace:" + method, (id: unknown, ...args: unknown[]) => {
      const current = workspace;
      if (!current || id !== token) throw new Error("This repository is no longer open.");
      return current.exclusive(() => (current[method] as (...a: unknown[]) => Promise<unknown>)(...args));
    });

  const activate = async (location: Location) => {
    const next = await Workspace.open(location);
    let snapshot;
    try {
      snapshot = (await next.snapshot())!;
    } catch (error) {
      next.dispose();
      throw error;
    }
    workspace?.dispose();
    workspace = next;
    token = randomUUID();
    store.remember(location, snapshot.settings.name);
    updateJumpList(store.recent);
    window.setTitle(`${snapshot.settings.name} — GitDesk`);
    return { token, snapshot };
  };

  handle("desktop:pickFolder", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Open a repository",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : fromWindowsPath(result.filePaths[0]);
  });

  handle("desktop:open", (location: unknown) => activate(validateLocation(location)));

  handle("desktop:restore", async () => {
    // A renderer reload keeps the open repository.
    if (workspace) {
      token = randomUUID();
      const snapshot = await workspace.exclusive(() => workspace!.snapshot());
      return { token, snapshot };
    }
    const requested = locationFromArgs(process.argv);
    if (requested) return activate(requested).catch(() => null);
    const last = store.recent[0];
    if (!store.preferences.reopenLast || !last) return null;
    return activate(last.location).catch(() => null);
  });

  handle("desktop:clone", async (url: unknown, parent: unknown) => {
    if (typeof url !== "string" || !url.trim() || url.length > 2048 || url.trim().startsWith("-") || /[\r\n\0]/.test(url))
      throw new Error("Enter a Git URL or repository path.");
    const where = validateLocation(parent);
    const name =
      path.posix
        .basename(url.trim().replace(/[\\/]+$/, "").replace(/\\/g, "/"))
        .replace(/\.git$/, "")
        .replace(/[^A-Za-z0-9._-]/g, "-") || "repository";
    const host = createHost(where);
    try {
      const result = await host.run("git", ["clone", "--", url.trim(), name], {
        cwd: where.path,
        timeout: 15 * 60_000,
      });
      if (result.code !== 0) throw new Error(result.stderr.replace(/^fatal: /gm, "").trim());
    } finally {
      host.dispose();
    }
    const target =
      where.kind === "local" ? path.join(where.path, name) : path.posix.join(where.path, name);
    return activate({ ...where, path: target });
  });

  handle("desktop:close", () => {
    workspace?.dispose();
    workspace = null;
    token = null;
    window.setTitle("GitDesk");
  });

  handle("desktop:recent", () => store.recent);
  handle("desktop:forget", (location: unknown) => {
    store.forget(validateLocation(location));
    updateJumpList(store.recent);
  });
  handle("desktop:wslDistros", () => wslDistros());
  handle("desktop:preferences", () => store.preferences);
  handle("desktop:setPreferences", (value: unknown) => {
    const preferences = store.setPreferences((value ?? {}) as object);
    nativeTheme.themeSource = preferences.theme;
    return preferences;
  });
  handle("desktop:plantuml", (source: unknown) =>
    renderPlantUml(source as string, store.preferences.plantumlServer, net.fetch as typeof fetch),
  );
  handle("desktop:openExternal", async (url: unknown) => {
    if (typeof url !== "string" || !/^(https?:|mailto:)/i.test(url)) throw new Error("Only web and mail links open externally.");
    await shell.openExternal(url);
  });
  handle("desktop:rootPath", (id: unknown, scope: unknown) => {
    if (!workspace || id !== token) throw new Error("This repository is no longer open.");
    return workspace.rootPath(scope as "repo" | "content");
  });

  updateJumpList(store.recent);

  return {
    dispose: () => workspace?.dispose(),
    /** Opens a repository requested by a second launch (jump list, shell). */
    openFromArgs: (argv: string[]) => {
      const location = locationFromArgs(argv);
      if (location) window.webContents.send("desktop:open-request", location);
    },
  };
}
