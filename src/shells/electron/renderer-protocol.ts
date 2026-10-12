/**
 * Serves the built client from `genbeya://app/`, with a strict content
 * security policy. Only files below the client folder are served, and only
 * for the host `app`: Genbeya links (`genbeya://open?…`) share the scheme but
 * reach the app as launch arguments, never as requests.
 */
import path from "node:path";

export const RENDERER_SCHEME = "genbeya";
export const RENDERER_ORIGIN = `${RENDERER_SCHEME}://app`;
export const RENDERER_URL = `${RENDERER_ORIGIN}/index.html`;

/** The file a renderer URL names, or an error when it points elsewhere. */
export function resolveAsset(root: string, url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== `${RENDERER_SCHEME}:` || parsed.host !== "app") throw new Error("Not a renderer URL.");
  const relative = decodeURIComponent(parsed.pathname).replace(/^\/+/, "") || "index.html";
  if (relative.includes("\0") || relative.includes("\\")) throw new Error("Invalid renderer path.");
  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) throw new Error("Outside the renderer.");
  return file;
}

/** True for the one page that may use the bridge. */
export const isRendererPage = (url: string, devOrigin: string | null): boolean => {
  try {
    const parsed = new URL(url);
    return devOrigin
      ? parsed.origin === devOrigin
      : parsed.protocol === `${RENDERER_SCHEME}:` && parsed.host === "app" && parsed.pathname === "/index.html";
  } catch {
    return false;
  }
};
