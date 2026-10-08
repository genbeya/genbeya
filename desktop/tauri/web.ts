/**
 * Renderer entry for Tauri. Tauri's backend is Rust, so the engine and the
 * desktop session run here in the webview; files and processes go through
 * the Node shims in ./node, backed by src-tauri.
 */
import "./globals";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Store } from "../../electron/state";
import type {} from "../../src/api";
import { rendererApi } from "../renderer-api";
import { DesktopSession, handle, locationFromArgs } from "../session";

const window_ = getCurrentWindow();

const session = (async () => {
  const [folder, argv] = await Promise.all([appDataDir(), invoke<string[]>("launch_args")]);
  return new DesktopSession(await Store.load(folder), {
    pickFolder: async () => {
      const folder = await open({ directory: true, title: "Open a repository" });
      return typeof folder === "string" ? folder : null;
    },
    openExternal: (url) => openUrl(url),
    setTitle: (title) => void window_.setTitle(title),
    setTheme: (theme) => void window_.setTheme(theme === "system" ? null : theme),
    recentChanged: () => undefined,
    fetch: (...args) => fetch(...args),
    argv,
  });
})();

window.gitdesk = rendererApi(
  async (method, args) => handle(await session, method, args),
  (callback) => {
    // A second launch (single-instance plugin) forwards its arguments.
    const stop = listen<string[]>("open-request", ({ payload }) => {
      const location = locationFromArgs(payload);
      if (location) callback(location);
    });
    return () => void stop.then((unlisten) => unlisten());
  },
);

// The renderer vetoes closing while edits are unsaved.
void window_.onCloseRequested(async (event) => {
  const unload = new Event("beforeunload", { cancelable: true });
  dispatchEvent(unload);
  if (unload.defaultPrevented && !confirm("You have unsaved changes. Close anyway and discard them?"))
    return event.preventDefault();
  await (await session).dispose();
});
