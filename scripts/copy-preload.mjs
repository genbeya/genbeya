import { copyFileSync } from "node:fs";
copyFileSync("electron/preload.cjs", "dist-electron/electron/preload.cjs");
