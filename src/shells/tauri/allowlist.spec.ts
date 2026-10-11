import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GIT_ENVIRONMENT } from "../../access/hosts/host";

/** Rust's allowlist of variables the backend may set, read from the source. */
function allowedEnvironment(): string[] {
  const source = readFileSync(path.join(__dirname, "src-tauri/src/processes.rs"), "utf8");
  const list = /const ENVIRONMENT: &\[&str\] = &\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]!);
}

/** Every `GIT_…` or `GCM_…` key with a string value in the access layer, where processes are started. */
function environmentKeys(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".spec.ts"))
    .flatMap((entry) => [...readFileSync(path.join(entry.parentPath, entry.name), "utf8").matchAll(/\b((?:GIT|GCM)_[A-Z_]+)\s*:\s*["'`]/g)])
    .map((match) => match[1]!);
}

// Tauri refuses processes with other variables, and only the Electron app runs end to end.
describe("the Tauri shell's process allowlist", () => {
  it("allows every variable the backend sets", () => {
    const allowed = allowedEnvironment();
    expect(allowed.length).toBeGreaterThan(0);
    for (const key of [...Object.keys(GIT_ENVIRONMENT), ...environmentKeys(path.join(__dirname, "../../access"))]) {
      expect(allowed, `${key} is set by the backend`).toContain(key);
    }
  });
});
