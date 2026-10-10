// npm postinstall: node-pty's macOS prebuilds ship `spawn-helper` without its
// executable bit, and every terminal then fails with "posix_spawnp failed".
// electron-builder keeps the mode, so the packaged app gets it too.
import { chmodSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

const prebuilds = path.join("node_modules", "node-pty", "prebuilds");
for (const platform of existsSync(prebuilds) ? readdirSync(prebuilds) : []) {
  const helper = path.join(prebuilds, platform, "spawn-helper");
  if (platform.startsWith("darwin") && existsSync(helper)) chmodSync(helper, 0o755);
}
