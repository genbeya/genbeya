import type { DesktopAPI } from "../shared/api";

declare global {
  interface Window {
    gitdesk: DesktopAPI;
  }
}

export const api = (): DesktopAPI => window.gitdesk;

/** Strips Electron's IPC wrapper from error messages. */
export function errorMessage(error: unknown) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, "");
}
