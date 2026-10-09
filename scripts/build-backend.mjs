// node scripts/build-backend.mjs [electron|deno]: bundles one shell (default electron).
import { build } from "esbuild";
import { denoBundle, electronBundle } from "./bundles.mjs";

const bundles = { electron: electronBundle, deno: denoBundle };
const shell = process.argv[2] ?? "electron";
if (!(shell in bundles)) throw new Error(`Unknown shell ${shell}; use electron or deno.`);
await build(bundles[shell]);
