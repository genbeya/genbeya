import type { DenoBindings, ElectronBridge } from "../../../contracts/bridges";
import { connectDeno } from "./deno-connector";
import { connectElectron } from "./electron-connector";
import type { Platform } from "./platform";

interface ShellGlobals {
  genbeyaElectron?: ElectronBridge;
  bindings?: DenoBindings;
  __TAURI_INTERNALS__?: unknown;
}

/** Connects to whichever shell hosts this page. */
export async function connectPlatform(page: ShellGlobals = globalThis as ShellGlobals): Promise<Platform> {
  if (page.genbeyaElectron) return connectElectron(page.genbeyaElectron);
  if (page.__TAURI_INTERNALS__) return (await import("./tauri-connector")).connectTauri();
  if (page.bindings) return connectDeno(page.bindings);
  throw new Error("Genbeya is a desktop app. Start it with npm start.");
}
