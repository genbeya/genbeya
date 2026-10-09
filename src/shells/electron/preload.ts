/**
 * Exposes {@link ElectronBridge} to the sandboxed page. Bundled to CommonJS;
 * the main process checks every message's sender.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { ElectronBridge } from "../../contracts/bridges";

const bridge: ElectronBridge = {
  call: (request) => ipcRenderer.invoke("gitdesk:call", request),
  shell: (operation, args) => ipcRenderer.invoke("gitdesk:shell", operation, args),
  onSecondLaunch(listener) {
    const handler = (_event: IpcRendererEvent, args: readonly string[]) => listener(args);
    ipcRenderer.on("gitdesk:second-launch", handler);
    return () => void ipcRenderer.removeListener("gitdesk:second-launch", handler);
  },
};

contextBridge.exposeInMainWorld("gitdeskElectron", bridge);
