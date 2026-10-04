const { contextBridge, ipcRenderer } = require("electron");
let repository = null;
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
];
const api = Object.fromEntries(
  methods.map((method) => [
    method,
    (...args) => ipcRenderer.invoke("repo:" + method, repository, ...args),
  ]),
);
for (const method of ["openRepository", "cloneRepository", "createDemo"])
  api[method] = async (...args) => {
    const selected = await ipcRenderer.invoke("desktop:" + method, ...args);
    if (selected) repository = selected;
    return Boolean(selected);
  };
contextBridge.exposeInMainWorld("gitdesk", api);
