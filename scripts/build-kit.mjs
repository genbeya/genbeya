// node scripts/build-kit.mjs [--zip]: builds the kit (src/shells/kit) into dist/kit, the renderer
// and editor that other hosts show in a web view (see the wiki's Architecture/Kit page). Writes
// manifest.json, every file with its SHA-256, and LICENSES.txt, the licenses of everything
// bundled. --zip also packs it as release-kit/genbeya-kit-<version>.zip, which releases attach.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { kitBundle } from "./bundles.mjs";

// The protocol's version and the content security policy, from the sources that define them.
const { KIT_PROTOCOL, CONTENT_SECURITY_POLICY } = await constants();

const output = kitBundle.outdir;
const { version } = JSON.parse(await readFile("package.json", "utf8"));

await rm(output, { recursive: true, force: true });
const { metafile } = await build({ ...kitBundle, define: { GENBEYA_VERSION: JSON.stringify(version) } });

// A meta tag can't carry frame-ancestors; the host decides who frames the kit.
const policy = CONTENT_SECURITY_POLICY.split("; ")
  .filter((directive) => !directive.startsWith("frame-ancestors"))
  .join("; ");
const page = (await readFile("src/shells/kit/kit.html", "utf8")).replace("%CONTENT_SECURITY_POLICY%", policy);
await writeFile(`${output}/kit.html`, page);
// PlantUML's engine, which the kit loads the first time it draws a PlantUML diagram.
await copyFile("node_modules/@rockuml/core/rockuml.wasm", `${output}/rockuml.wasm`);
await writeFile(`${output}/LICENSES.txt`, await licenses(metafile));

const files = await listFiles(output);
const commit = process.env["GITHUB_SHA"] ?? gitCommit();
const manifest = {
  name: "genbeya-kit",
  genbeya: version,
  commit,
  protocol: KIT_PROTOCOL,
  files: await Promise.all(
    files.map(async (file) => {
      const content = await readFile(path.join(output, file));
      return { path: file, sha256: createHash("sha256").update(content).digest("hex"), bytes: content.length };
    }),
  ),
};
await writeFile(`${output}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
const total = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
console.log(`dist/kit: ${manifest.files.length} files, ${(total / 1024 / 1024).toFixed(1)} MB, protocol ${KIT_PROTOCOL}.`);

if (process.argv.includes("--zip")) {
  await mkdir("release-kit", { recursive: true });
  const target = path.resolve(`release-kit/genbeya-kit-${version}.zip`);
  await rm(target, { force: true });
  // -X leaves out file attributes that differ between machines.
  const { status, error } = spawnSync("zip", ["-r", "-X", "-q", target, "."], { cwd: output, stdio: "inherit" });
  if (error) throw error;
  if (status !== 0) process.exit(status ?? 1);
  console.log(`${path.relative(process.cwd(), target)}: ${((await stat(target)).size / 1024 / 1024).toFixed(1)} MB.`);
}

async function constants() {
  const { outputFiles } = await build({
    stdin: {
      contents:
        'export { KIT_PROTOCOL } from "./src/shells/kit/protocol";\n' +
        'export { CONTENT_SECURITY_POLICY } from "./src/shells/content-security-policy";\n',
      resolveDir: process.cwd(),
      loader: "ts",
    },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    logLevel: "warning",
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

/** Every file below `folder`, relative and with slashes, sorted. */
async function listFiles(folder, prefix = "") {
  const found = [];
  for (const entry of await readdir(path.join(folder, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await listFiles(folder, relative)));
    else found.push(relative);
  }
  return found.sort();
}

/**
 * The license texts of the packages esbuild bundled (with rockuml, whose WebAssembly is copied, and
 * the fonts), from their own files: one section per package, by name.
 */
async function licenses(meta) {
  const packages = new Set(["node_modules/@rockuml/core"]);
  for (const input of Object.keys(meta.inputs)) {
    const match = /^(.*?node_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input.replace(/\\/g, "/"));
    if (match) packages.add(match[1]);
  }
  const sections = [];
  for (const folder of [...packages].sort()) {
    const manifest = JSON.parse(await readFile(path.join(folder, "package.json"), "utf8"));
    const names = (await readdir(folder)).filter((name) => /^(licen[cs]e|copying|notice|third-party)/i.test(name)).sort();
    const texts = [];
    for (const name of names) {
      const file = path.join(folder, name);
      if (existsSync(file) && (await stat(file)).isFile()) texts.push((await readFile(file, "utf8")).trim());
    }
    const license = typeof manifest.license === "string" ? manifest.license : "see below";
    sections.push(
      `${manifest.name} ${manifest.version} (${license})\n${"=".repeat(60)}\n\n${texts.join("\n\n") || "No license file in the package."}`,
    );
  }
  return `Genbeya's kit bundles the following packages.\n\n${sections.join("\n\n\n")}\n`;
}
