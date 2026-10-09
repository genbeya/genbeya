import type { DenoBindings, ElectronBridge } from "../../../contracts/bridges";
import { connectDeno } from "./deno-connector";
import { connectElectron } from "./electron-connector";
import type { Platform } from "./platform";

interface ShellGlobals {
  gitdeskElectron?: ElectronBridge;
  bindings?: DenoBindings;
  __TAURI_INTERNALS__?: unknown;
}

/** Connects to whichever shell hosts this page. */
export async function connectPlatform(page: ShellGlobals = globalThis as ShellGlobals): Promise<Platform> {
  if (page.gitdeskElectron) return connectElectron(page.gitdeskElectron);
  if (page.__TAURI_INTERNALS__) return (await import("./tauri-connector")).connectTauri();
  if (page.bindings) return connectDeno(page.bindings);
  throw new Error("GitDesk is a desktop app. Start it with npm start.");
}
