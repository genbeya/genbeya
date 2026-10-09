import type { Routes } from "@angular/router";
import { confirmLeave } from "./core/unsaved-changes";

/** Views take their state from query parameters, so every view is a back/forward stop. */
export const routes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "wiki" },
  { path: "wiki", loadComponent: () => import("./features/wiki/wiki-view").then((m) => m.WikiView), canDeactivate: [confirmLeave] },
  { path: "tasks", loadComponent: () => import("./features/tasks/tasks-view").then((m) => m.TasksView), canDeactivate: [confirmLeave] },
  { path: "code", loadComponent: () => import("./features/code/code-view").then((m) => m.CodeView), canDeactivate: [confirmLeave] },
  {
    path: "changes",
    loadComponent: () => import("./features/changes/changes-view").then((m) => m.ChangesView),
    canDeactivate: [confirmLeave],
  },
  { path: "history", loadComponent: () => import("./features/history/history-view").then((m) => m.HistoryView) },
  {
    path: "settings",
    loadComponent: () => import("./features/settings/settings-view").then((m) => m.SettingsView),
    canDeactivate: [confirmLeave],
  },
  { path: "**", redirectTo: "wiki" },
];
