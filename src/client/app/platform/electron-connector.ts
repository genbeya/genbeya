import type { ElectronBridge } from "../../../contracts/bridges";
import type { Location } from "../../../contracts/model";
import { connectManagers } from "../../../contracts/rpc";
import type { Platform } from "./platform";

/** The managers in Electron's main process, through the preload bridge. */
export function connectElectron(bridge: ElectronBridge): Platform {
  return {
    managers: connectManagers((request) => bridge.call(request)),
    shell: {
      runtime: "electron",
      pickFolder: () => bridge.shell("pickFolder", []) as Promise<Location | null>,
      openExternal: async (url) => void (await bridge.shell("openExternal", [url])),
      setTitle: (title) => void bridge.shell("setTitle", [title]),
      setTheme: (theme) => void bridge.shell("setTheme", [theme]),
      launchArgs: () => bridge.shell("launchArgs", []) as Promise<readonly string[]>,
      onSecondLaunch: (listener) => bridge.onSecondLaunch(listener),
      guardClose(hasUnsavedChanges) {
        // Electron asks the user natively when the page vetoes unloading.
        const veto = (event: BeforeUnloadEvent) => {
          if (hasUnsavedChanges()) event.preventDefault();
        };
        addEventListener("beforeunload", veto);
        return () => removeEventListener("beforeunload", veto);
      },
    },
  };
}
