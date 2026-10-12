import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { LINK_SCHEMES } from "../../contracts/genbeya-link";
import { CONTENT_SECURITY_POLICY } from "../content-security-policy";

/** Tauri's IPC reaches Rust through these; the other shells have no use for them. */
const TAURI_CONNECT_SOURCES = new Set(["ipc:", "http://ipc.localhost"]);

const config = JSON.parse(readFileSync(new URL("src-tauri/tauri.conf.json", import.meta.url), "utf8")) as {
  app: { security: { csp: string } };
  plugins: { "deep-link": { desktop: { schemes: string[] } } };
};

/** Directive name to its sorted sources. */
function directives(policy: string): Record<string, string[]> {
  const entries = policy.split(";").map((directive) => directive.trim().split(/\s+/));
  return Object.fromEntries(entries.map(([name, ...sources]) => [name!, sources.sort()]));
}

it("keeps the Tauri CSP in step with the shared policy", () => {
  const tauri = directives(config.app.security.csp);
  tauri["connect-src"] = (tauri["connect-src"] ?? []).filter((source) => !TAURI_CONNECT_SOURCES.has(source));
  expect(tauri).toEqual(directives(CONTENT_SECURITY_POLICY));
});

it("registers the schemes of Genbeya links and of GitDesk's, and only those", () => {
  expect(config.plugins["deep-link"].desktop.schemes).toEqual(["genbeya", "gitdesk"]);
  expect(config.plugins["deep-link"].desktop.schemes).toEqual(LINK_SCHEMES);
});
