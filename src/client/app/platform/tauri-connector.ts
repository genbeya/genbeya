/**
 * Tauri's backend is Rust, so the managers run here in the webview, on the
 * Tauri machine ports. Requests still cross a cloning transport, so the
 * client sees the same isolated values as under Electron and Deno.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { appDataDir } from "@tauri-apps/api/path";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { connectManagers, dispatch } from "../../../contracts/rpc";
import { locationOfFolder } from "../../../access/hosts/host-factory";
import { createBackend } from "../../../managers/backend";
import { tauriMachine } from "../../../platforms/tauri/tauri-machine";
import type { Platform } from "./platform";

export async function connectTauri(): Promise<Platform> {
  const backend = await createBackend(tauriMachine(), await appDataDir());
  const window = getCurrentWindow();
  return {
    managers: connectManagers(async (request) => structuredClone(await dispatch(backend, structuredClone(request)))),
    shell: {
      runtime: "tauri",
      async pickFolder() {
        const folder = await open({ directory: true, title: "Open a repository" });
        return typeof folder === "string" ? locationOfFolder(folder) : null;
      },
      async openExternal(url) {
        if (!/^(https?:|mailto:)/i.test(url)) throw new Error("Only web and mail links open externally.");
        await openUrl(url);
      },
      setTitle: (title) => void window.setTitle(title),
      setTheme: (theme) => void window.setTheme(theme === "system" ? null : theme),
      launchArgs: () => invoke<string[]>("launch_args"),
      onSecondLaunch(listener) {
        const stop = listen<string[]>("open-request", ({ payload }) => listener(payload));
        return () => void stop.then((unlisten) => unlisten());
      },
      guardClose(hasUnsavedChanges) {
        const stop = window.onCloseRequested(async (event) => {
          const discard =
            !hasUnsavedChanges() ||
            (await ask("Close anyway and discard them?", {
              title: "You have unsaved changes.",
              kind: "warning",
              okLabel: "Discard changes",
              cancelLabel: "Keep editing",
            }));
          if (discard) await backend.dispose();
          else event.preventDefault();
        });
        return () => void stop.then((unlisten) => unlisten());
      },
    },
  };
}
