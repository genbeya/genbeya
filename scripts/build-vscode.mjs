// node scripts/build-vscode.mjs [--package]: builds the VS Code extension into dist/vscode, which
// the "Run the VS Code extension" launch configuration loads; --package also packs it as
// release-vscode/Genbeya-<version>-vscode.vsix. The extension takes the app's version.
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { vscodeBundle, vscodeWebviewBundle } from "./bundles.mjs";

const output = vscodeBundle.outdir;
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile("src/shells/vscode/manifest.json", "utf8"));

await rm(output, { recursive: true, force: true });
await Promise.all([build(vscodeBundle), build(vscodeWebviewBundle)]);
await writeFile(`${output}/package.json`, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
// Source maps help debugging, not users; node-pty is left out, as the extension opens no terminals.
await writeFile(`${output}/.vscodeignore`, "**/*.map\n");
for (const [from, to] of [
  ["src/shells/vscode/README.md", "README.md"],
  // The Marketplace shows extension icons at 128 pixels; npm run icons renders this one from the logo.
  ["src/shells/tauri/src-tauri/icons/128x128.png", "icon.png"],
  ["branding/genbeya-mono.svg", "genbeya-mono.svg"],
  ["LICENSE.md", "LICENSE.md"],
  ["LICENSE-MIT-0.md", "LICENSE-MIT-0.md"],
  // PlantUML's engine, which the webviews load on first use.
  ["node_modules/@rockuml/core/rockuml.wasm", "webview/rockuml.wasm"],
]) {
  await copyFile(from, `${output}/${to}`);
}

if (process.argv.includes("--package")) {
  await mkdir("release-vscode", { recursive: true });
  const vsce = createRequire(import.meta.url).resolve("@vscode/vsce/vsce");
  const target = `${process.cwd()}/release-vscode/Genbeya-${version}-vscode.vsix`;
  const { status, error } = spawnSync(process.execPath, [vsce, "package", "--no-dependencies", "--out", target], {
    cwd: output,
    stdio: "inherit",
  });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
}
