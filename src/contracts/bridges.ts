/**
 * What each desktop shell injects into the page, and the shell operations
 * it relays. The client's connectors turn these into the managers and
 * {@link ShellContract}; the shells implement them.
 */
import type { Location, Theme } from "./model";
import type { Reply } from "./rpc";

/** Shell operations that need the shell's process (dialogs, the window, launch arguments). */
export interface ShellOperations {
  pickFolder(): Promise<Location | null>;
  openExternal(url: string): Promise<void>;
  setTitle(title: string): Promise<void>;
  setTheme(theme: Theme): Promise<void>;
  launchArgs(): Promise<readonly string[]>;
}

export const SHELL_OPERATIONS = [
  "pickFolder",
  "openExternal",
  "setTitle",
  "setTheme",
  "launchArgs",
] as const satisfies readonly (keyof ShellOperations)[];

export type ShellOperation = (typeof SHELL_OPERATIONS)[number];

/** `window.genbeyaElectron`, exposed by the Electron preload. */
export interface ElectronBridge {
  call(request: unknown): Promise<Reply>;
  shell(operation: ShellOperation, args: readonly unknown[]): Promise<unknown>;
  onSecondLaunch(listener: (args: readonly string[]) => void): () => void;
}

/**
 * Deno Desktop cannot veto closing from the page, so the shell asks this
 * page global (set by the client) whether edits are unsaved.
 */
export const DENO_UNSAVED_CHECK = "genbeyaHasUnsavedChanges";

/** The `bindings` global Deno Desktop provides; each binding takes one JSON value. */
export interface DenoBindings {
  genbeya(request: unknown): Promise<Reply>;
  genbeyaShell(request: { operation: ShellOperation; args: readonly unknown[] }): Promise<unknown>;
}
