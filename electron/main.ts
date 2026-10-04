import { app, BrowserWindow, dialog, ipcMain, protocol, net } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { RepositoryEngine } from "./engine.js";
import { resolveAsset } from "./assets.js";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "gitdesk",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);
const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow;
let engine: RepositoryEngine | undefined;
let token: string | null = null;
let selecting = false;
const dev = !app.isPackaged && process.env.GITDESK_DEV === "1";
const rendererRoot = path.resolve(here, "../../dist");
function trusted(event: Electron.IpcMainInvokeEvent) {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Untrusted IPC sender.");
  const url = new URL(event.senderFrame?.url ?? "about:blank");
  const valid = dev
    ? url.origin === "http://127.0.0.1:5173"
    : url.protocol === "gitdesk:" &&
      url.host === "app" &&
      url.pathname === "/index.html";
  if (!valid) throw new Error("Untrusted renderer URL.");
}
/** Plain recursive copy; unlike fs.cp it can read from a packaged app.asar. */
async function copyTree(from: string, to: string) {
  await fs.mkdir(to, { recursive: true });
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name),
      target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyTree(source, target);
    else await fs.writeFile(target, await fs.readFile(source));
  }
}
async function select(folder: string) {
  engine = await RepositoryEngine.open(folder);
  token = randomUUID();
  return token;
}
const methods = [
  "snapshot",
  "read",
  "save",
  "createPage",
  "createTask",
  "updateTask",
  "diff",
  "stage",
  "unstage",
  "commit",
  "switchBranch",
  "createBranch",
  "sync",
  "setRemote",
  "saveSettings",
  "commitFiles",
] as const;
for (const method of methods)
  ipcMain.handle("repo:" + method, async (event, id, ...args) => {
    trusted(event);
    if (!engine || id !== token) throw new Error("Open a repository first.");
    const current = engine;
    return current.exclusive(async () => {
      if (current !== engine || id !== token)
        throw new Error(
          "The selected repository changed. Refresh the workspace.",
        );
      const fn = current[method] as (...args: any[]) => Promise<unknown>;
      return fn.apply(current, args);
    });
  });
function desktop(
  method: string,
  operation: (...args: any[]) => Promise<string | null>,
) {
  ipcMain.handle("desktop:" + method, async (event, ...args) => {
    trusted(event);
    if (selecting)
      throw new Error("A repository selection is already in progress.");
    selecting = true;
    try {
      return await operation(...args);
    } finally {
      selecting = false;
    }
  });
}
desktop("openRepository", async () => {
  const selected = await dialog.showOpenDialog(window, {
    title: "Open a Git repository",
    properties: ["openDirectory"],
  });
  return selected.canceled ? null : select(selected.filePaths[0]);
});
desktop("cloneRepository", async (url: unknown) => {
  if (
    typeof url !== "string" ||
    !url.trim() ||
    url.length > 2048 ||
    url.startsWith("-") ||
    /[\r\n\0]/.test(url)
  )
    throw new Error("Enter a valid Git URL or local repository path.");
  const selected = await dialog.showOpenDialog(window, {
    title: "Choose the parent directory for the clone",
    properties: ["openDirectory"],
  });
  if (selected.canceled) return null;
  const name =
    path
      .basename(url.replace(/[\/\\]+$/, ""))
      .replace(/\.git$/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-") || "repository";
  const target = path.join(selected.filePaths[0], name);
  await exec("git", ["clone", "--", url, target], {
    timeout: 180000,
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return select(target);
});
desktop("createDemo", async () => {
  const selected = await dialog.showOpenDialog(window, {
    title: "Choose where to create the demo repository",
    properties: ["openDirectory", "createDirectory"],
  });
  if (selected.canceled) return null;
  const target = path.join(selected.filePaths[0], "gitdesk-demo-" + Date.now());
  await copyTree(path.resolve(here, "../../sample"), target);
  // Global signing or hook setups must not block the throwaway demo history.
  const git = (args: string[]) =>
    exec(
      "git",
      [
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
        ...args,
      ],
      { cwd: target, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } },
    );
  await git(["init", "-b", "main"]);
  await git(["config", "user.name", "GitDesk Demo"]);
  await git(["config", "user.email", "demo@gitdesk.local"]);
  await git(["add", "."]);
  await git(["commit", "-m", "Create repository-native workspace"]);
  await git(["switch", "-c", "feature/authentication"]);
  await fs.appendFile(
    path.join(target, "docs/Architecture/Backend/Authentication.md"),
    "\n## Sessions\nSession tokens expire after 24 hours.\n",
  );
  await git(["add", "."]);
  await git(["commit", "-m", "Document session lifecycle"]);
  await git(["switch", "main"]);
  await fs.appendFile(
    path.join(target, "docs/Home.md"),
    "\n## This week\nShip the first working prototype.\n",
  );
  await git(["add", "."]);
  await git(["commit", "-m", "Add this week’s delivery goal"]);
  await git([
    "merge",
    "--no-ff",
    "feature/authentication",
    "-m",
    "Merge authentication documentation",
  ]);
  await fs.appendFile(
    path.join(target, "src/index.ts"),
    "\n// Next: wire up persistent project settings.\n",
  );
  return select(target);
});
app.whenReady().then(() => {
  protocol.handle("gitdesk", async (request) => {
    if (request.method !== "GET")
      return new Response("Method not allowed", { status: 405 });
    try {
      return await net.fetch(
        pathToFileURL(resolveAsset(rendererRoot, request.url)).href,
      );
    } catch {
      return new Response("Asset not found", { status: 404 });
    }
  });
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    title: "GitDesk",
    backgroundColor: "#f7f8fa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  // Electron silently cancels close/reload when the renderer vetoes beforeunload; ask instead.
  window.webContents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      buttons: ["Discard changes", "Keep editing"],
      defaultId: 1,
      cancelId: 1,
      title: "Unsaved changes",
      message: "You have unsaved editor changes.",
      detail: "Discard them and continue?",
    });
    if (choice === 0) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false),
  );
  if (dev) void window.loadURL("http://127.0.0.1:5173");
  else void window.loadURL("gitdesk://app/index.html");
});
app.on("window-all-closed", () => app.quit());
