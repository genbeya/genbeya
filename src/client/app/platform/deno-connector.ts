import { DENO_UNSAVED_CHECK, type DenoBindings, type ShellOperation } from "../../../contracts/bridges";
import type { Location } from "../../../contracts/model";
import { connectManagers } from "../../../contracts/rpc";
import type { Platform } from "./platform";

/** The managers in the Deno Desktop process, through its bindings. */
export function connectDeno(bindings: DenoBindings): Platform {
  const shell = (operation: ShellOperation, ...args: unknown[]) => bindings.genbeyaShell({ operation, args });
  return {
    managers: connectManagers((request) => bindings.genbeya(request)),
    shell: {
      runtime: "deno",
      pickFolder: () => shell("pickFolder") as Promise<Location | null>,
      openExternal: async (url) => void (await shell("openExternal", url)),
      setTitle: (title) => void shell("setTitle", title),
      setTheme: (theme) => void shell("setTheme", theme),
      launchArgs: () => shell("launchArgs") as Promise<readonly string[]>,
      // Deno Desktop has no single-instance support yet.
      onSecondLaunch: () => () => undefined,
      guardClose(hasUnsavedChanges) {
        const page = globalThis as Record<string, unknown>;
        page[DENO_UNSAVED_CHECK] = hasUnsavedChanges;
        return () => void (page[DENO_UNSAVED_CHECK] = undefined);
      },
    },
  };
}
