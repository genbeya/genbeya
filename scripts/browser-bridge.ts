/**
 * Development only: serves the workspace API over HTTP on 127.0.0.1 so the
 * renderer can run in a plain browser (`npm run dev:browser`), e.g. for
 * design work and screenshots. Not part of the app.
 *
 *   GITDESK_REPO=/path/to/repo npx tsx scripts/browser-bridge.ts
 */
import { createServer } from "node:http";
import path from "node:path";
import type { Location, Preferences } from "../shared/api.js";
import { validateLocation, wslDistros } from "../core/hosts.js";
import { Workspace } from "../core/workspace.js";
import { renderPlantUml } from "../electron/plantuml.js";

const PORT = 5174;
const ORIGIN = "http://127.0.0.1:5173";
const repo: Location = { kind: "local", path: path.resolve(process.env.GITDESK_REPO ?? ".") };
let workspace: Workspace | null = null;
let preferences: Preferences = { theme: "system", reopenLast: true, autoSyncContent: false, plantumlServer: "" };

const open = async (location: Location) => {
  const next = await Workspace.open(validateLocation(location));
  workspace?.dispose();
  workspace = next;
  return next.snapshot();
};

const desktop: Record<string, (...args: any[]) => unknown> = {
  pickFolder: () => repo,
  open,
  restore: () => (workspace ? workspace.snapshot() : open(repo)),
  clone: () => {
    throw new Error("Cloning is not available in the browser bridge.");
  },
  close: () => {
    workspace?.dispose();
    workspace = null;
  },
  recent: () => [{ location: repo, name: path.basename(repo.path), openedAt: Date.now() - 3_600_000 }],
  forget: () => undefined,
  wslDistros,
  preferences: () => preferences,
  setPreferences: (value: Partial<Preferences>) => (preferences = { ...preferences, ...value }),
  plantuml: (source: string) => renderPlantUml(source, preferences.plantumlServer, fetch),
  openExternal: () => undefined,
  rootPath: (scope: "repo" | "content") => workspace!.rootPath(scope),
};

createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", ORIGIN);
  response.setHeader("Access-Control-Allow-Headers", "content-type");
  if (request.method === "OPTIONS") return response.end();
  if (request.method !== "POST" || request.headers.origin !== ORIGIN) {
    response.statusCode = 403;
    return response.end();
  }
  let body = "";
  for await (const chunk of request) body += chunk;
  const { method, args } = JSON.parse(body) as { method: string; args: unknown[] };
  try {
    let result: unknown;
    if (method in desktop) result = await desktop[method](...args);
    else if (workspace && typeof (workspace as any)[method] === "function") {
      const current = workspace;
      result = await current.exclusive(() => (current as any)[method](...args));
    } else throw new Error(`Unknown method ${method}`);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ result: result ?? null }));
  } catch (error: any) {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ error: error.message }));
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Browser bridge for ${repo.path} on http://127.0.0.1:${PORT}`));
