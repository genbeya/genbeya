/**
 * Exposes {@link ElectronBridge} to the sandboxed page. Bundled to CommonJS;
 * the main process checks every message's sender.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ElectronBridge } from "../../contracts/bridges";

const bridge: ElectronBridge = {
  call: (request) => ipcRenderer.invoke("genbeya:call", request),
  shell: (operation, args) => ipcRenderer.invoke("genbeya:shell", operation, args),
  onSecondLaunch(listener) {
    const handler = (_event: IpcRendererEvent, args: readonly string[]) => listener(args);
    ipcRenderer.on("genbeya:second-launch", handler);
    return () => void ipcRenderer.removeListener("genbeya:second-launch", handler);
  },
};

contextBridge.exposeInMainWorld("genbeyaElectron", bridge);
