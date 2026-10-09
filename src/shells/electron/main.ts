/**
 * The Electron shell: one sandboxed window showing the client, the managers
 * in this process, and a validated IPC channel between them.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, screen, shell, type IpcMainInvokeEvent } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SHELL_OPERATIONS, type ShellOperation } from "../../contracts/bridges";
import type { Theme } from "../../contracts/model";
import { dispatch } from "../../contracts/rpc";
import { locationOfFolder } from "../../access/hosts/host-factory";
import { createBackend, type Backend } from "../../managers/backend";
import { nodeMachine } from "../../platforms/node/node-machine";
import { updateJumpList } from "./jump-list";
import { CONTENT_SECURITY_POLICY } from "../content-security-policy";
import { isRendererPage, RENDERER_URL, resolveAsset } from "./renderer-protocol";
import { placeOnScreen, WindowState } from "./window-state";

protocol.registerSchemesAsPrivileged([
  { scheme: "gitdesk", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

const DEV_ORIGIN = !app.isPackaged ? (process.env["GITDESK_DEV_SERVER"] ?? null) : null;
const CLIENT_ROOT = path.resolve(__dirname, "../client/browser");
const THEMES: readonly Theme[] = ["system", "light", "dark"];
/** Workspace calls after which the recent list may have changed. */
const RECENT_CHANGES = new Set(["open", "restore", "clone", "forget"]);

/** A second launch hands its arguments to the first instance (see `second-instance`) and stops here. */
const primary = app.requestSingleInstanceLock();
if (!primary) app.exit(0);

function serveClient() {
  protocol.handle("gitdesk", async (request) => {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    try {
      const response = await net.fetch(pathToFileURL(resolveAsset(CLIENT_ROOT, request.url)).href);
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

/** macOS needs an Edit menu for clipboard shortcuts; elsewhere there is none. */
function setMenu() {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]));
}

function createWindow(state: WindowState): BrowserWindow {
  const saved =
    state.bounds &&
    placeOnScreen(
      state.bounds,
      screen.getAllDisplays().map((display) => display.workArea),
    );
  const window = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 920,
    ...(saved ? { x: saved.x, y: saved.y } : {}),
    minWidth: 960,
    minHeight: 600,
    title: "GitDesk",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#121316" : "#ffffff",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (saved?.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());

  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  // Copy buttons write to the clipboard; nothing else is granted.
  contents.session.setPermissionRequestHandler((requester, permission, callback) =>
    callback(permission === "clipboard-sanitized-write" && isRendererPage(requester.getURL(), DEV_ORIGIN)),
  );
  // The page vetoes unloading while edits are unsaved; ask before discarding them.
  contents.on("will-prevent-unload", (event) => {
    const choice = dialog.showMessageBoxSync(window, {
      type: "question",
      buttons: ["Discard changes", "Keep editing"],
      defaultId: 1,
      cancelId: 1,
      message: "You have unsaved changes.",
      detail: "Close anyway and discard them?",
    });
    if (choice === 0) event.preventDefault();
  });
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    // Without the default menu, zoom needs its own shortcuts.
    const zoom = mod && !input.alt ? ({ "=": 0.5, "+": 0.5, "-": -0.5, "0": 0 } as Record<string, number>)[input.key] : undefined;
    if (zoom !== undefined) {
      contents.setZoomLevel(zoom === 0 ? 0 : Math.max(-3, Math.min(4, contents.getZoomLevel() + zoom)));
      event.preventDefault();
    } else if (DEV_ORIGIN && input.key === "F12") {
      contents.toggleDevTools();
      event.preventDefault();
    }
  });

  const remember = () => state.remember({ ...window.getNormalBounds(), maximized: window.isMaximized() });
  window.on("resize", remember);
  window.on("move", remember);
  window.on("maximize", remember);
  window.on("unmaximize", remember);
  return window;
}

function connect(window: BrowserWindow, backend: Backend) {
  const trusted = (event: IpcMainInvokeEvent) => {
    const frame = event.senderFrame;
    if (event.sender !== window.webContents || !frame || frame !== window.webContents.mainFrame || !isRendererPage(frame.url, DEV_ORIGIN))
      throw new Error("Untrusted sender.");
  };

  ipcMain.handle("gitdesk:call", async (event, request: { manager?: unknown; method?: unknown }) => {
    trusted(event);
    const reply = await dispatch(backend, request);
    if (reply.ok && request?.manager === "workspace" && RECENT_CHANGES.has(String(request.method)))
      updateJumpList(await backend.workspace.recent());
    return reply;
  });

  const operations: Record<ShellOperation, (...args: unknown[]) => Promise<unknown>> = {
    async pickFolder() {
      const result = await dialog.showOpenDialog(window, { title: "Open a repository", properties: ["openDirectory", "createDirectory"] });
      return result.canceled || !result.filePaths[0] ? null : locationOfFolder(result.filePaths[0]);
    },
    async openExternal(url) {
      if (typeof url !== "string" || !/^(https?:|mailto:)/i.test(url)) throw new Error("Only web and mail links open externally.");
      await shell.openExternal(url);
    },
    async setTitle(title) {
      window.setTitle(typeof title === "string" && title.length < 300 ? title : "GitDesk");
    },
    async setTheme(theme) {
      if (THEMES.includes(theme as Theme)) nativeTheme.themeSource = theme as Theme;
    },
    async launchArgs() {
      return process.argv;
    },
  };
  ipcMain.handle("gitdesk:shell", (event, operation: unknown, args: unknown) => {
    trusted(event);
    if (!SHELL_OPERATIONS.includes(operation as ShellOperation)) throw new Error("Unknown shell operation.");
    return operations[operation as ShellOperation](...(Array.isArray(args) ? args : []));
  });
}

if (primary) void app.whenReady().then(start);

async function start() {
  const userData = app.getPath("userData");
  const [backend, state] = await Promise.all([createBackend(nodeMachine(), userData), WindowState.load(userData)]);
  serveClient();
  setMenu();
  const window = createWindow(state);
  connect(window, backend);
  updateJumpList(await backend.workspace.recent());
  app.on("second-instance", (_event, argv) => {
    if (window.isMinimized()) window.restore();
    window.focus();
    window.webContents.send("gitdesk:second-launch", argv);
  });
  // Once the window has closed (the page may still veto that), quitting waits for repositories to close and state to be written.
  // Then it exits: on macOS a second app.quit() after a prevented will-quit does nothing.
  app.once("will-quit", (event) => {
    event.preventDefault();
    void Promise.allSettled([backend.dispose(), state.flush()]).then(() => app.exit(0));
  });
  await window.loadURL(DEV_ORIGIN ?? RENDERER_URL);
}

app.on("window-all-closed", () => app.quit());
