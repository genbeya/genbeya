// Sandboxed preload: CommonJS, no imports. Keep the method list in sync with electron/ipc.ts.
const { contextBridge, ipcRenderer } = require("electron");

const workspaceMethods = [
  "snapshot", "read", "image", "write", "remove", "createPage", "movePage", "deletePage", "createTask",
  "updateTask", "deleteTask", "diff", "stage", "unstage", "discard", "commit",
  "lastCommitMessage", "log", "commitDetail", "switchBranch", "createBranch", "sync",
  "setRemote", "removeRemote", "saveSettings", "setStorage", "syncContent",
];

let token = null;
const api = {};

for (const method of workspaceMethods)
  api[method] = (...args) => ipcRenderer.invoke("workspace:" + method, token, ...args);

// These return { token, snapshot }; the token stays in the preload.
for (const method of ["open", "restore", "clone"])
  api[method] = async (...args) => {
    const result = await ipcRenderer.invoke("desktop:" + method, ...args);
    if (!result) return null;
    token = result.token;
    return result.snapshot;
  };

api.close = async () => {
  await ipcRenderer.invoke("desktop:close");
  token = null;
};
api.rootPath = (scope) => ipcRenderer.invoke("desktop:rootPath", token, scope);

// Repositories requested from the taskbar jump list; the renderer confirms
// unsaved edits, then opens them like any other.
api.onOpenRequest = (callback) => {
  const listener = (_event, location) => callback(location);
  ipcRenderer.on("desktop:open-request", listener);
  return () => ipcRenderer.removeListener("desktop:open-request", listener);
};

for (const method of [
  "pickFolder", "recent", "forget", "wslDistros", "preferences", "setPreferences", "plantuml", "openExternal",
])
  api[method] = (...args) => ipcRenderer.invoke("desktop:" + method, ...args);

contextBridge.exposeInMainWorld("gitdesk", api);
