import { app, BrowserWindow, dialog, Menu, nativeTheme, net, protocol, screen } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveAsset } from "./assets.js";
import { registerIpc } from "./ipc.js";
import { Store } from "./state.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "gitdesk",
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const here = path.dirname(fileURLToPath(import.meta.url));
const dev = !app.isPackaged && process.env.GITDESK_DEV === "1";
const DEV_ORIGIN = "http://127.0.0.1:5173";

if (!app.requestSingleInstanceLock()) app.quit();

/** Only the bundled renderer (or the Vite dev server) may call the main process. */
const rendererOrigin = (url: URL) =>
  dev
    ? url.origin === DEV_ORIGIN
    : url.protocol === "gitdesk:" && url.host === "app" && url.pathname === "/index.html";

function serveRenderer() {
  const root = path.resolve(here, "../../dist");
  protocol.handle("gitdesk", async (request) => {
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
    try {
      return await net.fetch(pathToFileURL(resolveAsset(root, request.url)).href);
    } catch {
      return new Response("Not found", { status: 404 });
    }
  });
}

function setMenu() {
  if (process.platform !== "darwin") return Menu.setApplicationMenu(null);
  // macOS needs an Edit menu for clipboard shortcuts.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]),
  );
}

function visible(bounds: { x: number; y: number; width: number; height: number }) {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y,
  );
}

async function createWindow(store: Store) {
  const saved = store.bounds && visible(store.bounds) ? store.bounds : null;
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
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });
  if (saved?.maximized) window.maximize();
  window.once("ready-to-show", () => window.show());

  const contents = window.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.session.setPermissionRequestHandler((_c, _p, callback) => callback(false));
  // The renderer vetoes unloading while edits are unsaved; Electron would cancel silently.
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
    const zoom = mod && !input.alt ? { "=": 0.5, "+": 0.5, "-": -0.5, "0": 0 }[input.key] : undefined;
    if (zoom !== undefined) {
      contents.setZoomLevel(zoom === 0 ? 0 : Math.max(-3, Math.min(4, contents.getZoomLevel() + zoom)));
      event.preventDefault();
    } else if (dev && input.key === "F12") {
      contents.toggleDevTools();
      event.preventDefault();
    }
  });

  const remember = () => {
    const b = window.getNormalBounds();
    store.bounds = { ...b, maximized: window.isMaximized() };
  };
  window.on("resize", remember);
  window.on("move", remember);
  window.on("maximize", remember);
  window.on("unmaximize", remember);

  const ipc = registerIpc(window, store, rendererOrigin);
  window.on("closed", ipc.dispose);

  await window.loadURL(dev ? DEV_ORIGIN : "gitdesk://app/index.html");
  return { window, ipc };
}

app.whenReady().then(async () => {
  const store = await Store.load(app.getPath("userData"));
  // The renderer styles itself from prefers-color-scheme, which follows this.
  nativeTheme.themeSource = store.preferences.theme;
  serveRenderer();
  setMenu();
  const { window, ipc } = await createWindow(store);
  app.on("second-instance", (_event, argv) => {
    if (window.isMinimized()) window.restore();
    window.focus();
    ipc.openFromArgs(argv);
  });
  app.on("before-quit", () => void store.flush());
});

app.on("window-all-closed", () => app.quit());
