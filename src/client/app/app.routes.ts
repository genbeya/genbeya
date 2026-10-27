import type { Routes } from "@angular/router";
import { guardedBy } from "./core/unsaved-changes";

/**
 * Views take their state from query parameters, so every view is a back/forward stop.
 * Views with editors ask before a navigation discards unsaved edits.
 */
export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "wiki" },
  { path: "wiki", loadComponent: () => import("./features/wiki/wiki-view").then((m) => m.WikiView), ...guardedBy("page", "folder") },
  { path: "tasks", loadComponent: () => import("./features/tasks/tasks-view").then((m) => m.TasksView), ...guardedBy("task", "create") },
  { path: "code", loadComponent: () => import("./features/code/code-view").then((m) => m.CodeView), ...guardedBy("file") },
  {
    path: "changes",
    loadComponent: () => import("./features/changes/changes-view").then((m) => m.ChangesView),
    ...guardedBy("conflict"),
  },
  { path: "history", loadComponent: () => import("./features/history/history-view").then((m) => m.HistoryView) },
  { path: "pulls", loadComponent: () => import("./features/pulls/pulls-view").then((m) => m.PullsView) },
  { path: "settings", loadComponent: () => import("./features/settings/settings-view").then((m) => m.SettingsView), ...guardedBy() },
  { path: "**", redirectTo: "wiki" },
];
