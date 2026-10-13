// node scripts/test-vscode.mjs: runs src/shells/vscode/test/smoke.ts inside VS Code, with the
// extension that `npm run build:vscode` built, on a sample repository in a temporary folder.
// VS Code comes from VSCODE_EXECUTABLE if set (an installed Code), else it is downloaded to .vscode-test/.
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runTests } from "@vscode/test-electron";
import { build } from "esbuild";

const tests = resolve("dist/vscode-test");
await build({
  entryPoints: { smoke: "src/shells/vscode/test/smoke.ts" },
  outdir: tests,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["vscode"],
  logLevel: "warning",
});

const work = await mkdtemp(join(tmpdir(), "genbeya-vscode-"));
const repository = join(work, "sample");
const files = {
  ".genbeya.yml": "name: Smoke\nwikiRoot: docs\nwikiHome: Home.md\ntaskRoot: tasks\ntaskPrefix: SMOKE\nstatuses: [todo, done]\n",
  "docs/Home.md": "# Home\n\nThe sample's wiki.\n",
  "tasks/SMOKE-1.md": "---\nid: SMOKE-1\ntitle: Try the extension\nstatus: todo\n---\n\nOpen it in VS Code.\n",
};
for (const [path, content] of Object.entries(files)) {
  await mkdir(join(repository, path, ".."), { recursive: true });
  await writeFile(join(repository, path), content);
}
const git = (...args) => execFileSync("git", args, { cwd: repository, stdio: "ignore" });
git("init", "--quiet", "--initial-branch=main");
// A throwaway repository: its own identity, never the user's configuration.
git("config", "user.name", "Smoke Test");
git("config", "user.email", "smoke@example.invalid");
git("add", ".");
git("commit", "--quiet", "-m", "Sample");

try {
  await runTests({
    vscodeExecutablePath: process.env["VSCODE_EXECUTABLE"] || undefined,
    extensionDevelopmentPath: resolve("dist/vscode"),
    extensionTestsPath: join(tests, "smoke.cjs"),
    launchArgs: [repository, "--disable-extensions", "--disable-workspace-trust", "--user-data-dir", join(work, "user-data")],
  });
} finally {
  await rm(work, { recursive: true, force: true, maxRetries: 5 });
}
