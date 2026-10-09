/**
 * What the desktop shell (Electron, Tauri or Deno Desktop) offers the client
 * besides the managers: native dialogs, the window, and launch requests.
 */
import type { Location, Theme } from "./model";

export interface ShellContract {
  /** Which runtime hosts the client; shown in diagnostics only. */
  readonly runtime: "electron" | "tauri" | "deno";
  /** Shows a folder picker; a picked `\\wsl$` folder opens through WSL. Null when cancelled. */
  pickFolder(): Promise<Location | null>;
  /** Opens an http(s) or mailto link in the system's default application. */
  openExternal(url: string): Promise<void>;
  setTitle(title: string): void;
  /** The theme of native window parts (title bar, scroll bars, dialogs). */
  setTheme(theme: Theme): void;
  /** Command-line arguments of this launch, e.g. a repository picked from the jump list. */
  launchArgs(): Promise<readonly string[]>;
  /** Called with the arguments of a second launch while this window is open. */
  onSecondLaunch(listener: (args: readonly string[]) => void): () => void;
  /**
   * Called when the user closes the window. Returning false keeps it open;
   * the client asks about unsaved changes first.
   */
  onCloseRequest(listener: () => boolean): () => void;
}
