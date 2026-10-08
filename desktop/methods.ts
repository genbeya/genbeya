/** Method names shared by the desktop shells and their renderer adapter. */
import type { WorkspaceAPI } from "../shared/api.js";

export const WORKSPACE_METHODS: (keyof WorkspaceAPI)[] = [
  "snapshot", "read", "image", "write", "remove", "createPage", "movePage", "deletePage", "createTask",
  "updateTask", "deleteTask", "diff", "stage", "unstage", "discard", "commit",
  "lastCommitMessage", "log", "commitDetail", "switchBranch", "createBranch", "sync",
  "setRemote", "removeRemote", "saveSettings", "setStorage", "syncContent",
];

export const OPENING_METHODS = ["open", "restore", "clone"] as const;
export const DESKTOP_METHODS = [
  "pickFolder", "recent", "forget", "wslDistros", "preferences", "setPreferences", "plantuml", "openExternal",
] as const;
