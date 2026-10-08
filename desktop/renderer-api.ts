/**
 * window.gitdesk for the non-Electron shells, mirroring electron/preload.cjs:
 * every call goes through one `send(method, args)` transport, and the
 * workspace token stays here rather than in the app.
 */
import type { DesktopAPI, Location, Snapshot } from "../shared/api";
import { DESKTOP_METHODS, OPENING_METHODS, WORKSPACE_METHODS } from "./methods";

export type Send = (method: string, args: unknown[]) => Promise<unknown>;

export function rendererApi(send: Send, onOpenRequest?: DesktopAPI["onOpenRequest"]): DesktopAPI {
  let token: string | null = null;
  const api: Record<string, unknown> = {};

  for (const method of WORKSPACE_METHODS)
    api[method] = (...args: unknown[]) => send("workspace", [method, token, ...args]);

  for (const method of OPENING_METHODS)
    api[method] = async (...args: unknown[]) => {
      const result = (await send(method, args)) as { token: string; snapshot: Snapshot } | null;
      if (!result) return null;
      token = result.token;
      return result.snapshot;
    };

  api.close = async () => {
    await send("close", []);
    token = null;
  };
  api.rootPath = (scope: unknown) => send("rootPath", [token, scope]);
  for (const method of DESKTOP_METHODS) api[method] = (...args: unknown[]) => send(method, args);
  if (onOpenRequest) api.onOpenRequest = onOpenRequest;
  return api as unknown as DesktopAPI;
}

export type { Location };
